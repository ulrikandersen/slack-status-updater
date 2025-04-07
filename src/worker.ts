/// <reference types="@cloudflare/workers-types" />

import { Env, getGoogleCalendarWorkLocation } from './google-calendar';
import { updateSlackStatus, sendSlackMessage } from './slack';

/**
 * Main handler for updating status based on calendar events
 */
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