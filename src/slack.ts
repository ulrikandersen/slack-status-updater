/// <reference types="@cloudflare/workers-types" />

import { Env } from './google-calendar';

// Interfaces
export interface SlackResponse {
  ok: boolean;
  error?: string;
}

export interface SlackProfile {
  status_text: string;
  status_emoji: string;
}

interface SlackProfileResponse {
  ok: boolean;
  profile: SlackProfile;
  error?: string;
}

/**
 * Fetches the current Slack status for the user
 */
export async function getCurrentSlackStatus(env: Env): Promise<SlackProfile | null> {
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

/**
 * Updates the user's Slack status
 */
export async function updateSlackStatus(env: Env, status_text: string, status_emoji: string): Promise<void> {
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

/**
 * Sends a reminder message to the user
 */
export async function sendSlackMessage(env: Env): Promise<void> {
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

/**
 * Sends authentication failure notification to the user
 */
export async function sendAuthFailureNotification(env: Env): Promise<void> {
  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: env.SLACK_USER_ID,
        text: '🚨 *Google Authentication Failed* 🚨\nThe Google refresh token appears to have expired. Please generate a new refresh token by running `npx ts-node get_token.ts` and update your environment variables.',
      }),
    });

    const data = await response.json() as SlackResponse;
    if (!data.ok) {
      console.error('Failed to send auth failure notification:', data.error);
    } else {
      console.log('Auth failure notification sent successfully');
    }
  } catch (error) {
    console.error('Error sending auth failure notification:', error);
  }
}