import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

const getClient = () => {
  // Always use process.env.API_KEY directly as per @google/genai guidelines
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

export const ensureImageGenApiKey = async (): Promise<boolean> => {
  const win = window as any;
  if (win.aistudio) {
    try {
      const hasKey = await win.aistudio.hasSelectedApiKey();
      if (!hasKey) {
          await win.aistudio.openSelectKey();
          // Assume success to avoid race condition where hasSelectedApiKey() might not update immediately
          return true;
      }
      return true;
    } catch (e) {
      console.error("Key selection failed", e);
      return false;
    }
  }
  return true; // Fallback if not running in the specific environment
};

export const generateStudioBackground = async (prompt: string): Promise<string | null> => {
  const ai = getClient();
  
  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: {
        parts: [{ text: `A professional, high-quality digital streaming background, cinematic lighting, ${prompt}` }],
      },
      config: {
        imageConfig: {
          aspectRatio: "16:9",
          imageSize: "1K"
        }
      }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    return null;
  } catch (error) {
    console.error("Gemini Image Gen Error:", error);
    throw error;
  }
};

export const askStudioAssistant = async (query: string): Promise<string> => {
  const ai = getClient();

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: query,
      config: {
        systemInstruction: "You are Aether, an expert AI broadcast engineer. Help the user with technical streaming advice, script ideas, or chat engagement tips. Keep answers concise and actionable.",
      }
    });
    return response.text || "I couldn't generate a response.";
  } catch (error) {
    console.error("Gemini Chat Error:", error);
    return "Error connecting to AI services. Please check your network.";
  }
};