import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

async function test() {
  const models = [
    "gemini-3-flash-preview",
    "gemini-3.1-flash-lite-preview",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash",
    "gemini-flash-latest"
  ];
  
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  for (const m of models) {
    try {
      console.log(`Testing model: ${m} with googleSearch...`);
      const response = await ai.models.generateContent({
        model: m,
        contents: "Who is the prime minister of Pakistan right now?",
        config: {
          tools: [{ googleSearch: {} }]
        }
      });
      console.log(`\x1b[32mSUCCESS for ${m}:\x1b[0m`, response.text ? response.text.substring(0, 100) + "..." : "No text");
    } catch (e) {
      console.log(`\x1b[31mFAILED for ${m}:\x1b[0m`, e.message);
    }
  }
}

test();
