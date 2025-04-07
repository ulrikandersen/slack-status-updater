/// <reference types="@cloudflare/workers-types" />

import { sendAuthFailureNotification } from './slack';

// Interfaces
export interface Env {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REFRESH_TOKEN: string;
  SLACK_USER_TOKEN: string;
  SLACK_BOT_TOKEN: string;
  SLACK_USER_ID: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
}

interface CalendarEvent {
  location?: string;
  summary?: string;
  start?: {
    dateTime: string;
    timeZone: string;
    date?: string;
  };
  end?: {
    dateTime: string;
    timeZone: string;
    date?: string;
  }
  workingLocationProperties?: {
    type: string;
    officeLocation?: {
      buildingId?: string;
      floorId?: string;
      deskId?: string;
      label?: string;
    };
    customLocation?: {
      label?: string;
    };
  };
}

interface CalendarResponse {
  items?: CalendarEvent[];
  error?: {
    code: number;
    message: string;
    status: string;
  };
}

/**
 * Gets a new Google access token using the refresh token
 */
export async function getGoogleAccessToken(env: Env): Promise<string> {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  const data = await tokenResponse.json() as TokenResponse;
  if (!data.access_token) {
    console.error('Failed to get access token:', data);
    // Send a notification to Slack about the auth failure
    await sendAuthFailureNotification(env);
    throw new Error('Failed to get access token - refresh token may need updating');
  }

  return data.access_token;
}

/**
 * Fetches the user's work location from Google Calendar for the current day
 */
export async function getGoogleCalendarWorkLocation(env: Env): Promise<{ workLocation: string | null }> {
  const access_token = await getGoogleAccessToken(env);

  // Get today's calendar events in UTC
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0); // Set to start of day UTC (00:00:00)
  
  const endOfDay = new Date(today);
  endOfDay.setUTCHours(23, 59, 59, 999); // Set to end of day UTC (23:59:59)

  console.log('Fetching calendar events from', today.toISOString(), 'to', endOfDay.toISOString());

  const calendarResponse = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
    `timeMin=${today.toISOString()}&timeMax=${endOfDay.toISOString()}&orderBy=startTime&singleEvents=true&timeZone=UTC`,
    {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    }
  );

  const calendarData = await calendarResponse.json() as CalendarResponse;
  
  if (calendarData.error) {
    console.error('Calendar API error:', calendarData.error);
    throw new Error(`Calendar API error: ${calendarData.error.message}`);
  }

  // Look for working location in events
  for (const event of calendarData.items || []) {
    console.log('\nChecking event:', {
      start: event.start,
      end: event.end,
      summary: event.summary,
      workingLocationProperties: event.workingLocationProperties
    });

    // Only check the dedicated working location field
    if (event.workingLocationProperties) {
      console.log('Found working location properties:', event.workingLocationProperties);
      if (event.workingLocationProperties.type === 'officeLocation') {
        console.log('Found office location. Not setting status.');
        return { workLocation: 'Office' };
      } else if (event.workingLocationProperties.type.toLowerCase().includes('home')) {
        console.log('Found home location. Setting status to Working Remotely.');
        return { workLocation: 'Home' };
      }
    }
  }

  console.log('No working location found in any events');
  return { workLocation: null };
}