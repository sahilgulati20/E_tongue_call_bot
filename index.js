import Fastify from "fastify";
import WebSocket from "ws";
import dotenv from "dotenv";
import fastifyFormBody from "@fastify/formbody";
import fastifyWs from "@fastify/websocket";
import Twilio from "twilio";

// Load environment variables
dotenv.config();

const {
  ELEVENLABS_AGENT_ID,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
  RENDER_EXTERNAL_URL, // optional, set after deployment
} = process.env;

// Check required environment variables
if (!ELEVENLABS_AGENT_ID || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
  console.error("Missing required environment variables");
  process.exit(1);
}

// Initialize Fastify
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

// Initialize Twilio client
const twilioClient = Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Use Render-assigned PORT or fallback to 8000 locally
const PORT = process.env.PORT || 8000;
const HOST = "0.0.0.0"; // needed for Render

// Determine the base URL for Twilio webhooks
// Before deployment, this will fallback to localhost (for testing)
const BASE_URL = RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

// Health check route
fastify.get("/", async (_, reply) => {
  reply.send({ message: "Server is running" });
});

// Incoming Twilio call route
fastify.all("/incoming-call-eleven", async (request, reply) => {
  const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
      <Connect>
        <Stream url="wss://${BASE_URL.replace(/^https?:\/\//, "")}/media-stream" />
      </Connect>
    </Response>`;

  reply.type("text/xml").send(twimlResponse);
});

// WebSocket route for media streaming
fastify.register(async (fastifyInstance) => {
  fastifyInstance.get("/media-stream", { websocket: true }, (connection) => {
    console.info("[Server] Twilio connected to media stream.");

    let streamSid = null;

    // Connect to ElevenLabs WebSocket
    const elevenLabsWs = new WebSocket(
      `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${ELEVENLABS_AGENT_ID}`
    );

    elevenLabsWs.on("open", () => console.log("[II] Connected to Conversational AI."));
    elevenLabsWs.on("error", (err) => console.error("[II] WebSocket error:", err));
    elevenLabsWs.on("close", () => console.log("[II] Disconnected."));

    // Handle messages from ElevenLabs
    const handleElevenLabsMessage = (message) => {
      switch (message.type) {
        case "conversation_initiation_metadata":
          console.info("[II] Conversation initiated.");
          break;
        case "audio":
          if (message.audio_event?.audio_base_64) {
            connection.send(
              JSON.stringify({ event: "media", streamSid, media: { payload: message.audio_event.audio_base_64 } })
            );
          }
          break;
        case "interruption":
          connection.send(JSON.stringify({ event: "clear", streamSid }));
          break;
        case "ping":
          if (message.ping_event?.event_id) {
            elevenLabsWs.send(JSON.stringify({ type: "pong", event_id: message.ping_event.event_id }));
          }
          break;
      }
    };

    elevenLabsWs.on("message", (data) => {
      try {
        handleElevenLabsMessage(JSON.parse(data));
      } catch (err) {
        console.error("[II] Error parsing message:", err);
      }
    });

    // Handle messages from Twilio
    connection.on("message", (message) => {
      try {
        const data = JSON.parse(message);
        switch (data.event) {
          case "start":
            streamSid = data.start.streamSid;
            console.log(`[Twilio] Stream started with ID: ${streamSid}`);
            break;
          case "media":
            if (elevenLabsWs.readyState === WebSocket.OPEN) {
              elevenLabsWs.send(JSON.stringify({ user_audio_chunk: data.media.payload }));
            }
            break;
          case "stop":
            if (elevenLabsWs.readyState === WebSocket.OPEN) elevenLabsWs.close();
            break;
          default:
            console.log(`[Twilio] Unhandled event: ${data.event}`);
        }
      } catch (err) {
        console.error("[Twilio] Error processing message:", err);
      }
    });

    // Cleanup
    connection.on("close", () => {
      if (elevenLabsWs.readyState === WebSocket.OPEN) elevenLabsWs.close();
      console.log("[Twilio] Client disconnected");
    });

    connection.on("error", (err) => {
      console.error("[Twilio] WebSocket error:", err);
      if (elevenLabsWs.readyState === WebSocket.OPEN) elevenLabsWs.close();
    });
  });
});

// Outbound call route
fastify.post("/make-outbound-call", async (request, reply) => {
  const { to } = request.body;
  if (!to) return reply.status(400).send({ error: "Destination phone number is required" });

  try {
    const call = await twilioClient.calls.create({
      url: `${BASE_URL}/incoming-call-eleven`,
      to,
      from: TWILIO_PHONE_NUMBER,
    });
    console.log(`[Twilio] Outbound call initiated: ${call.sid}`);
    reply.send({ message: "Call initiated", callSid: call.sid });
  } catch (err) {
    console.error("[Twilio] Error initiating call:", err);
    reply.status(500).send({ error: "Failed to initiate call" });
  }
});

// Start Fastify server
fastify.listen({ port: PORT, host: HOST }, (err) => {
  if (err) {
    console.error("Error starting server:", err);
    process.exit(1);
  }
  console.log(`[Server] Listening on port ${PORT}`);
});
