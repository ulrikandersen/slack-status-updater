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
      await handleStatusUpdate(env);
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
      await handleStatusUpdate(env);
      return new Response('Status check completed', { status: 200 });
    } catch (error) {
      console.error('Error in worker:', error);
      return new Response('Error occurred', { status: 500 });
    }
  }
};

async function handleStatusUpdate(env: Env): Promise<void> {
  // Get Google Calendar events for today
  const calendar = await getGoogleCalendarWorkLocation(env);
  
  if (calendar.workLocation === 'Home') {
    // Update Slack status to "Working remotely"
    await updateSlackStatus(env, 'Working remotely', ':house_with_garden:');
  } else if (!calendar.workLocation) {
    // Notify user to set work location
    await sendSlackMessage(env);
  }
}

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

async function getGoogleCalendarWorkLocation(env: Env): Promise<{ workLocation: string | null }> {
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
    // Calculate end of current day in UTC (23:59:59)
    const today = new Date();
    today.setHours(23);
    today.setMinutes(59);
    today.setSeconds(59);
    today.setMilliseconds(999);
    const status_expiration = (today.getTime() / 1000);

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
          status_expiration,
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