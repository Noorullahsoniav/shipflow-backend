import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

async function test_json_output() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = "gemini-3.1-flash-lite";
  
  try {
    console.log(`Testing JSON schema generation with model: ${model}...`);
    const response = await ai.models.generateContent({
      model: model,
      contents: "lahore Sami ullah 0333-1234567 pso pump ke pa",
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            customerName: { type: Type.STRING },
            customerPhone: { type: Type.STRING },
            customerCity: { type: Type.STRING },
            customerAddress: { type: Type.STRING }
          }
        }
      }
    });
    console.log("\x1b[32mSuccess JSON parsing:\x1b[0m", JSON.parse(response.text));
  } catch (e) {
    console.error("\x1b[31mFailed JSON generation:\x1b[0m", e.message);
  }
}

test_json_output();
