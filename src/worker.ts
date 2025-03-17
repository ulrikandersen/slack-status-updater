/// <reference types="@cloudflare/workers-types" />

interface Env {
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

interface SlackResponse {
  ok: boolean;
  error?: string;
}

interface SlackProfile {
  status_text: string;
  status_emoji: string;
}

interface SlackProfileResponse {
  ok: boolean;
  profile: SlackProfile;
  error?: string;
}

export default {
  // Run every day at 8:00 AM
  scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    try {
      // Get Google Calendar events for today
      const calendar = await getGoogleCalendarWorkLocation(env);
      
      if (calendar.hasEvents && calendar.workLocation === 'Home') {
        // Update Slack status to "Working remotely"
        await updateSlackStatus(env, 'Working remotely', ':house:');
      } else if (calendar.hasEvents && !calendar.workLocation) {
        // Notify user to set work location only if there are events but no location
        await sendSlackMessage(env);
      }
    } catch (error) {
      console.error('Error in worker:', error);
    }
  },

  // Add fetch handler for local development only
  fetch: async (request: Request, env: Env, ctx: ExecutionContext) => {
    // Only allow the status endpoint in development mode
    const url = new URL(request.url);
    if (url.pathname !== '/') {
      return new Response('Not found', { status: 404 });
    }

    // Check if we're running locally by checking the hostname
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (!isLocalhost) {
      return new Response('Status endpoint is only available in development mode', { status: 403 });
    }

    try {
      // Get Google Calendar events for today
      const calendar = await getGoogleCalendarWorkLocation(env);
      
      if (calendar.hasEvents && calendar.workLocation === 'Home') {
        // Update Slack status to "Working remotely"
        await updateSlackStatus(env, 'Working remotely', ':house:');
      } else if (calendar.hasEvents && !calendar.workLocation) {
        // Notify user to set work location only if there are events but no location
        await sendSlackMessage(env);
      }

      return new Response('Status check completed', { status: 200 });
    } catch (error) {
      console.error('Error in worker:', error);
      return new Response('Error occurred', { status: 500 });
    }
  }
};

async function getGoogleAccessToken(env: Env): Promise<string> {
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
    throw new Error('Failed to get access token');
  }

  return data.access_token;
}

async function getGoogleCalendarWorkLocation(env: Env): Promise<{ workLocation: string | null; hasEvents: boolean }> {
  const access_token = await getGoogleAccessToken(env);

  // Get today's calendar events
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Set to start of day (00:00:00)
  
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0); // Set to start of next day (00:00:00)

  console.log('Fetching calendar events from', today.toISOString(), 'to', tomorrow.toISOString());

  const calendarResponse = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
    `timeMin=${today.toISOString()}&timeMax=${tomorrow.toISOString()}&orderBy=startTime&singleEvents=true`,
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

  const hasEvents = (calendarData.items?.length || 0) > 0;
  console.log('Found', calendarData.items?.length || 0, 'events for today');
  
  if (!hasEvents) {
    console.log('No events found for today');
    return { workLocation: null, hasEvents: false };
  }

  // Look for working location in events
  for (const event of calendarData.items || []) {
    console.log('\nChecking event:', {
      summary: event.summary,
      location: event.location,
      start: event.start,
      workingLocationProperties: event.workingLocationProperties
    });

    // Check for working location properties first
    if (event.workingLocationProperties) {
      console.log('Found working location properties:', event.workingLocationProperties);
      if (event.workingLocationProperties.type === 'officeLocation') {
        console.log('Found office location. Not setting status.');
        return { workLocation: 'Office', hasEvents: true };
      } else if (event.workingLocationProperties.type === 'customLocation' && 
                event.workingLocationProperties.customLocation?.label?.toLowerCase().includes('home')) {
        console.log('Found home location in custom location. Setting status to Working Remotely.');
        return { workLocation: 'Home', hasEvents: true };
      }
    }
    
    // Then check traditional location field and summary
    if (event.location?.toLowerCase().includes('home') || 
        event.summary?.toLowerCase().includes('home')) {
      console.log('Found home in location or summary');
      return { workLocation: 'Home', hasEvents: true };
    } else if (event.location?.toLowerCase().includes('office') || 
               event.summary?.toLowerCase().includes('office')) {
      console.log('Found office in location or summary');
      return { workLocation: 'Office', hasEvents: true };
    }
  }

  console.log('No working location found in any events');
  return { workLocation: null, hasEvents: true };
}

async function getCurrentSlackStatus(env: Env): Promise<SlackProfile | null> {
  const response = await fetch('https://slack.com/api/users.profile.get', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${env.SLACK_USER_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });

  const data = await response.json() as SlackProfileResponse;
  if (!data.ok) {
    console.error('Failed to get Slack status:', data.error);
    throw new Error(`Slack API error: ${data.error}`);
  }

  // Return null if no status is set
  if (!data.profile.status_text && !data.profile.status_emoji) {
    return null;
  }

  return data.profile;
}

async function updateSlackStatus(env: Env, status_text: string, status_emoji: string): Promise<void> {
  // First check if there's an existing status
  const currentStatus = await getCurrentSlackStatus(env);
  
  // Only update if there's no existing status
  if (!currentStatus) {
    const response = await fetch('https://slack.com/api/users.profile.set', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.SLACK_USER_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        profile: {
          status_text,
          status_emoji,
          status_expiration: 0,
        },
      }),
    });

    const data = await response.json() as SlackResponse;
    if (!data.ok) {
      console.error('Failed to update Slack status:', data.error);
      throw new Error(`Slack API error: ${data.error}`);
    }
  } else {
    console.log('Status already set, skipping update');
  }
}

async function sendSlackMessage(env: Env): Promise<void> {
  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channel: env.SLACK_USER_ID,
      text: 'Please set your working location in Google Calendar for today.',
    }),
  });

  const data = await response.json() as SlackResponse;
  if (!data.ok) {
    console.error('Failed to send Slack message:', data.error);
    throw new Error(`Slack API error: ${data.error}`);
  }
} 