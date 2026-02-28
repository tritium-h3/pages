import { Router, Request, Response } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import http from 'http';
import { ollama } from '../ollama.js';

// Mad Libs word lists
const adjectives = [
  'grumpy', 'cheerful', 'mysterious', 'clumsy', 'dramatic', 'sarcastic',
  'paranoid', 'energetic', 'sleepy', 'philosophical', 'anxious', 'eccentric',
  'melodramatic', 'optimistic', 'pessimistic', 'cynical'
];

const professions = [
  'pirate', 'wizard', 'accountant', 'detective', 'chef', 'astronaut',
  'librarian', 'ninja', 'dentist', 'time traveler', 'ghost hunter',
  'professional procrastinator', 'conspiracy theorist', 'influencer',
  'medieval knight', 'chaos coordinator'
];

const cities = [
  'Tokyo', 'Paris', 'the Moon', 'Atlantis', 'London', 'Hogwarts',
  'a distant planet', 'a haunted mall', 'the Void', 'cyberspace',
  'an underwater city', 'a floating island', 'the center of the Earth', 'Wonderland'
];

const situations = [
  'They just discovered {something} in {location}.',
  'They are stuck in {location} during {event}.',
  'They are arguing about {topic} while {activity}.',
  'They are trying to {goal} before {deadline}.',
  'They accidentally {accident} and now must {solution}.'
];

const somethings = [
  'a mysterious portal', 'a talking sandwich', 'their clone', 'the meaning of life',
  'a cursed object', 'an ancient prophecy', 'a bug in reality', 'infinite cookies'
];

const locations = [
  'an elevator', 'a laundromat', 'a spaceship', 'a parallel dimension',
  'a very long queue', 'a karaoke bar', 'a bouncy castle', 'the DMV'
];

const events = [
  'a zombie apocalypse', 'a dance-off competition', 'an alien invasion',
  'a mysterious blackout', 'a baking contest', 'a time loop', 'a glitch in reality'
];

const topics = [
  'whether hot dogs are sandwiches', 'the best superhero', 'pineapple on pizza',
  'time travel ethics', 'whether cereal is soup', 'the superiority of cats vs dogs',
  'the Oxford comma'
];

const activities = [
  'skydiving', 'running from danger', 'having tea', 'playing video games',
  'solving a puzzle', 'doing laundry', 'waiting in line'
];

const goals = [
  'escape the building', 'defuse a bomb', 'win a contest', 'break a curse',
  'save the world', 'order pizza', 'find their keys'
];

const deadlines = [
  'sunrise', 'their lunch break ends', 'the portal closes', 'they run out of snacks',
  'the universe implodes', 'happy hour ends', 'midnight strikes'
];

const accidents = [
  'swapped bodies', 'summoned a demon', 'deleted the internet',
  'broke the timeline', 'unleashed chaos', 'angered a god', 'turned invisible'
];

const solutions = [
  'fix it before anyone notices', 'explain it to their boss', 'run away',
  'find an ancient ritual', 'apologize profusely', 'blame it on Mercury retrograde'
];

function randomChoice<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function generateSituation(): string {
  const template = randomChoice(situations);
  return template
    .replace('{something}', randomChoice(somethings))
    .replace('{location}', randomChoice(locations))
    .replace('{event}', randomChoice(events))
    .replace('{topic}', randomChoice(topics))
    .replace('{activity}', randomChoice(activities))
    .replace('{goal}', randomChoice(goals))
    .replace('{deadline}', randomChoice(deadlines))
    .replace('{accident}', randomChoice(accidents))
    .replace('{solution}', randomChoice(solutions));
}

interface Character {
  name: string;
  personality: string;
}

function generateCharacter(): Character {
  const adj = randomChoice(adjectives);
  const prof = randomChoice(professions);
  const city = randomChoice(cities);
  
  return {
    name: `${adj.charAt(0).toUpperCase() + adj.slice(1)} ${prof.charAt(0).toUpperCase() + prof.slice(1)}`,
    personality: `A ${adj} ${prof} from ${city}`
  };
}

// Track active conversations
let activeConversations = 0;

// Create router for HTTP endpoints
const router = Router();

router.get('/llm-duo-chat/status', (req: Request, res: Response) => {
  res.json({ activeConversations });
});

// Initialize WebSocket server
export function initLLMDuoChatWebSocket(server: http.Server) {
  const wss = new WebSocketServer({ server, path: '/ws/llm-duo-chat' });

  wss.on('connection', (ws: WebSocket) => {
    const conversationId = `CONV-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    activeConversations++;
    console.log(`[${conversationId}] 🎬 WebSocket connected (Active conversations: ${activeConversations})`);

    let clientDisconnected = false;

    ws.on('close', () => {
      if (!clientDisconnected) {
        clientDisconnected = true;
        activeConversations--;
        console.log(`[${conversationId}] ❌ WebSocket disconnected (Active conversations: ${activeConversations})`);
      }
    });

    ws.on('error', (error) => {
      console.error(`[${conversationId}] ❌ WebSocket error:`, error);
    });

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        if (data.type === 'start') {
          console.log(`[${conversationId}] 📨 Received start request`);
          
          // Generate characters and situation on the backend
          const character1 = generateCharacter();
          const character2 = generateCharacter();
          const situation = generateSituation();

          console.log(`[${conversationId}] Characters: ${character1.name} vs ${character2.name}`);
          console.log(`[${conversationId}] Situation: ${situation}`);

          // Send the generated characters and situation first
          ws.send(JSON.stringify({ type: 'setup', character1, character2, situation }));

          const conversationHistory: Array<{ speaker: string; text: string }> = [];
          const MAX_TURNS = 6; // 3 exchanges (6 messages total)

          try {
            for (let turn = 0; turn < MAX_TURNS; turn++) {
              // Check if client disconnected
              if (clientDisconnected || ws.readyState !== WebSocket.OPEN) {
                console.log(`[${conversationId}] ⏹️  Stopping early due to disconnect (turn ${turn}/${MAX_TURNS})`);
                return;
              }

              const isChar1Turn = turn % 2 === 0;
              const currentChar = isChar1Turn ? character1 : character2;
              const otherChar = isChar1Turn ? character2 : character1;

              console.log(`[${conversationId}] 💬 Turn ${turn + 1}/${MAX_TURNS}: ${currentChar.name} speaking...`);

              // Build the conversation context
              let prompt = `You are ${currentChar.name}: ${currentChar.personality}.

The situation: ${situation}

You are having a conversation with ${otherChar.name} (${otherChar.personality}).

`;

              if (conversationHistory.length > 0) {
                prompt += 'Conversation so far:\n';
                conversationHistory.forEach(msg => {
                  prompt += `${msg.speaker}: ${msg.text}\n`;
                });
                prompt += '\n';
              }

              prompt += `Respond in character as ${currentChar.name}. Keep your response to 1-3 sentences. Be entertaining and stay in character!\n\nYour response:`;

              // Generate response using Ollama
              let fullResponse = '';
              const startTime = Date.now();
              for await (const chunk of ollama.generateStream({
                model: 'qwen3:14b',
                prompt: prompt,
                keep_alive: '60m',
                options: {
                  temperature: 0.9,
                  top_p: 0.9,
                }
              })) {
                // Check if client disconnected during generation
                if (clientDisconnected || ws.readyState !== WebSocket.OPEN) {
                  console.log(`[${conversationId}] ⏹️  Client disconnected during generation`);
                  return;
                }
                
                fullResponse += chunk;
                ws.send(JSON.stringify({ type: 'chunk', speaker: currentChar.name, chunk }));
              }
              const elapsed = Date.now() - startTime;
              console.log(`[${conversationId}] ✓ ${currentChar.name} finished speaking (${elapsed}ms, ${fullResponse.length} chars)`);

              // Add to conversation history
              conversationHistory.push({
                speaker: currentChar.name,
                text: fullResponse.trim()
              });

              // Small delay between turns
              await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Send completion message
            if (ws.readyState === WebSocket.OPEN) {
              activeConversations--;
              console.log(`[${conversationId}] ✅ Conversation completed successfully (${MAX_TURNS} turns) (Active conversations: ${activeConversations})`);
              ws.send(JSON.stringify({ type: 'done' }));
            }
          } catch (ollamaError) {
            if (!clientDisconnected) {
              activeConversations--;
            }
            console.error(`[${conversationId}] ❌ Ollama error (Active conversations: ${activeConversations}):`, ollamaError);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'error', message: 'Failed to generate chat from Ollama' }));
            }
          }
        }
      } catch (error) {
        console.error(`[${conversationId}] ❌ Error handling message:`, error);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'error', message: 'An error occurred' }));
        }
      }
    });
  });

  console.log('LLM Duo Chat WebSocket server initialized');
}

export default router;
