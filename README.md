### 1. Configure the Environment
Go to the Secrets tab (lock icon in the left sidebar).
Add the following environment variables:

ELEVENLABS_AGENT_ID=your-eleven-labs-agent-id
TWILIO_ACCOUNT_SID=your-twilio-account-sid
TWILIO_AUTH_TOKEN=your-twilio-auth-token
TWILIO_PHONE_NUMBER=your-twilio-phone-number
PORT=8000

### 2. Run the Server

Click the green Run button in Replit. The server will start, and Replit will provide a public URL for the project.

### 3. Test the System
For Outbound Calls:
Send a POST request to the /make-outbound-call endpoint with the recipient’s phone number:

curl -X POST https://your-replit-url.repl.co/make-outbound-call \
-H "Content-Type: application/json" \
-d '{"to": "+1234567890"}'






"# E_tongue_call_bot" 
"# E_tongue_call_bot" 
