# Slack Status Updater

A Cloudflare Worker that automatically updates your Slack status based on your Google Calendar work location. The worker checks your calendar events daily and sets your Slack status to "Working remotely" when you're working from home.

## Features

- Automatically checks Google Calendar events for work location
- Updates Slack status to "Working remotely" when working from home
- Sends notifications when work location is not set for scheduled events
- Runs daily at 8:00 AM via Cloudflare Cron
- Supports both office and home working locations
- Prevents duplicate status updates

## Acknowledgments

This project was developed with the assistance of [Cursor](https://cursor.sh), and Large Language Models (LLMs). Their capabilities in code generation, debugging, and documentation were invaluable in creating this tool efficiently.

## Prerequisites

- A Google Calendar API project with OAuth 2.0 credentials
- A Slack workspace with appropriate API tokens
- Node.js and npm installed
- Wrangler CLI installed (`npm install -g wrangler`)

## Setup

1. Clone the repository:
```bash
git clone https://github.com/ulrikandersen/slack-status-updater.git
cd slack-status-updater
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
   - Copy the example configuration file:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
   - Edit `.dev.vars` with your actual credentials:
     - `GOOGLE_CLIENT_ID`: Your Google OAuth client ID
     - `GOOGLE_CLIENT_SECRET`: Your Google OAuth client secret
     - `GOOGLE_REFRESH_TOKEN`: Your Google OAuth refresh token (obtained via `get_token.ts`)
     - `SLACK_USER_TOKEN`: Your Slack user token (starts with `xoxp-`)
     - `SLACK_BOT_TOKEN`: Your Slack bot token (starts with `xoxb-`)
     - `SLACK_USER_ID`: Your Slack user ID

4. Get your Google OAuth refresh token:
   - Make sure your `.dev.vars` file has `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` set
   - Run the token generator:
   ```bash
   npx ts-node get_token.ts
   ```
   - Open the provided URL in your browser
   - Authorize the application
   - Copy the refresh token from the console output to your `.dev.vars` file

## Local Development

1. Start the development server:
```bash
wrangler dev
```

2. Access the status endpoint:
   - Open your browser and navigate to `http://localhost:8787/status`
   - This will trigger the status check manually

## Deployment

1. Login to Cloudflare:
```bash
wrangler login
```

2. Set up your secrets in the Cloudflare dashboard:
   - Go to https://dash.cloudflare.com
   - Navigate to Workers & Pages
   - Select your worker
   - Go to Settings > Variables
   - Add all the environment variables from your `.dev.vars` file

3. Deploy the worker:
```bash
wrangler deploy
```

## Environment Variables

The following environment variables are required:

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | Google OAuth refresh token |
| `SLACK_USER_TOKEN` | Slack user token (starts with `xoxp-`) - used for setting status |
| `SLACK_BOT_TOKEN` | Slack bot token (starts with `xoxb-`) - used for sending reminder message |
| `SLACK_USER_ID` | Your Slack user ID |

## How It Works

1. The worker runs daily at 8:00 AM via Cloudflare Cron
2. It checks your Google Calendar events for the current day
3. If you have events scheduled:
   - If your work location is set to "Home", it updates your Slack status to "Working remotely"
   - If no work location is set, it sends you a Slack message to set your location
4. The status is only updated if you don't already have a status set

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
