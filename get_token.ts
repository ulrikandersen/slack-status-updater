const http = require('http');
const { parse } = require('url');
const fs = require('fs');
const path = require('path');

// Read credentials from .dev.vars file
function loadDevVars() {
  const devVarsPath = path.join(process.cwd(), '.dev.vars');
  const env: { [key: string]: string } = {};

  try {
    const content = fs.readFileSync(devVarsPath, 'utf8');
    content.split('\n').forEach((line: string) => {
      const [key, value] = line.split('=');
      if (key && value) {
        env[key.trim()] = value.trim();
      }
    });
  } catch (error) {
    console.error('Error reading .dev.vars file:', error);
    process.exit(1);
  }

  return env;
}

const env = loadDevVars();
const clientId = env.GOOGLE_CLIENT_ID;
const clientSecret = env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('Error: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .dev.vars file');
  process.exit(1);
}

const redirectUri = 'http://localhost:3000/oauth2callback';
const scope = 'https://www.googleapis.com/auth/calendar.readonly';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

// Create the authorization URL
const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
  `client_id=${clientId}&` +
  `redirect_uri=${redirectUri}&` +
  `response_type=code&` +
  `scope=${scope}&` +
  `access_type=offline&` +
  `prompt=consent`;

// Create a simple HTTP server to handle the OAuth callback
const server = http.createServer(async (req: any, res: any) => {
  const parsedUrl = parse(req.url || '', true);
  
  if (parsedUrl.pathname === '/oauth2callback') {
    const code = parsedUrl.query.code as string;
    
    if (code) {
      try {
        // Exchange the authorization code for tokens
        const response = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code: code,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }),
        });

        const data = await response.json() as TokenResponse;
        
        if (data.refresh_token) {
          console.log('\nAdd this to your .dev.vars file:');
          console.log(`GOOGLE_REFRESH_TOKEN=${data.refresh_token}\n`);
        } else {
          console.error('No refresh token received. Make sure to include prompt=consent in the auth URL.');
        }
      } catch (error) {
        console.error('Error exchanging code for tokens:', error);
      }
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('You can close this window now.');
    
    // Close the server
    server.close();
  }
});

// Start the server and print the URL
server.listen(3000, () => {
  console.log('Please visit this URL to authorize the application:');
  console.log(authUrl);
}); 