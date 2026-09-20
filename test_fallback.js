import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

async function test_chat_fallback() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = "gemini-3-flash-preview";
  
  try {
    console.log("Attempting with Google Search...");
    const chat = ai.chats.create({
      model: model,
      config: {
        systemInstruction: "You are a helpful assistant.",
        tools: [{ googleSearch: {} }]
      }
    });
    const response = await chat.sendMessage({ message: "Who is the Prime Minister of Pakistan?" });
    console.log("Success with search:", response.text);
  } catch (error) {
    console.warn("Got error with search:", error.message || error);
    console.log("\x1b[33mFalling back to standard chat without Search Grounding...\x1b[0m");
    
    try {
      const fallbackChat = ai.chats.create({
        model: model,
        config: {
          systemInstruction: "You are a helpful assistant (search grounding is currently unavailable, so rely on your knowledge base)."
        }
      });
      const response = await fallbackChat.sendMessage({ message: "Who is the Prime Minister of Pakistan?" });
      console.log("\x1b[32mSuccess on standard fallback:\x1b[0m", response.text);
    } catch (fallbackError) {
      console.error("Fallback failed too:", fallbackError.message);
    }
  }
}

test_chat_fallback();
