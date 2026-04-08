import { Paths, Directory, File } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import { LLMModule, SpeechToTextModule, TokenizerModule, VADModule, initExecutorch } from 'react-native-executorch';
import { ExpoResourceFetcher } from 'react-native-executorch-expo-resource-fetcher';

/**
 * Interface representing an AI interaction result.
 */
export interface ChatMessage {
    id: string;
    text: string;
    sender: 'user' | 'ai';
    timestamp: number;
}

const MODEL_DIR_NAME = 'ai_models';
let isInitialized = false;
let activeDownloadPromise: Promise<any> | null = null;

/**
 * A local-first resource fetcher that handles absolute paths and file:// URIs.
 * Bypasses the default fetcher's HEAD request which causes protocol errors.
 */
const CustomAIResourceFetcher = {
    fetch: async (onProgress: (p: number) => void, ...sources: string[]) => {
        // Since we ensure download before loading, we just return the paths without file:// for the native engine
        onProgress(1);
        return sources.map(s => s.startsWith('file://') ? s.replace('file://', '') : s);
    },

    readAsString: async (path: string) => {
        const uri = path.startsWith('file://') ? path : `file://${path}`;
        const file = new File(uri);
        return await file.text();
    }
};

/**
 * Service to handle on-device AI operations.
 */
export const aiService = {
  initialize: async () => {
    if (isInitialized) return;
    try {
      // Ensure the local model directory exists
      const modelDir = new Directory(Paths.document, MODEL_DIR_NAME);
      if (!modelDir.exists) {
        await modelDir.create({ idempotent: true });
      }
      
      initExecutorch({
        resourceFetcher: CustomAIResourceFetcher as any
      });
      isInitialized = true;
      console.log('AI Service initialized (Local-First Fetcher).');
    } catch (error) {
      console.error('Failed to initialize AI service:', error);
    }
  },

  /**
   * Downloads and prepares the model in INTERNAL storage.
   */
  ensureModelDownloaded: async (modelConfig: any, onProgress?: (p: number, status: string) => void) => {
    if (activeDownloadPromise) {
        console.log('Download already active, joining task...');
        return activeDownloadPromise;
    }

    activeDownloadPromise = (async () => {
        try {
            const internalDir = new Directory(Paths.document, MODEL_DIR_NAME);
            if (!internalDir.exists) await internalDir.create();

            const fileName = (url: string) => url.split('/').pop() || 'model_part';
            const sources = [
                { url: modelConfig.modelSource, key: 'modelSource' },
                { url: modelConfig.tokenizerSource, key: 'tokenizerSource' },
                { url: modelConfig.tokenizerConfigSource, key: 'tokenizerConfigSource' }
            ];

            const updatedConfig = { ...modelConfig };
            let totalFiles = sources.length;

            for (let i = 0; i < sources.length; i++) {
                const item = sources[i];
                if (typeof item.url !== 'string') continue;

                const name = fileName(item.url);
                const targetFile = new File(internalDir, name);
                
                if (targetFile.exists) {
                    console.log(`Using cached: ${name}`);
                    updatedConfig[item.key] = targetFile.uri;
                    continue;
                }

                console.log(`Downloading ${name} to internal storage...`);
                const downloadResumable = FileSystem.createDownloadResumable(
                    item.url,
                    targetFile.uri,
                    {},
                    (downloadProgress) => {
                        const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
                        const overallProgress = (i + progress) / totalFiles;
                        onProgress?.(overallProgress, `Downloading ${name}... ${Math.round(progress * 100)}%`);
                    }
                );

                const result = await downloadResumable.downloadAsync();
                if (!result) throw new Error(`Download of ${name} failed.`);
                
                updatedConfig[item.key] = result.uri;
            }

            onProgress?.(1, 'AI weights ready!');
            return updatedConfig;
        } catch (error) {
            console.error('Internal download failed:', error);
            throw error;
        } finally {
            activeDownloadPromise = null;
        }
    })();

    return activeDownloadPromise;
  },

  pickCustomDirectory: async () => {
    // Kept as no-op to avoid breaking UI if called, but we no longer use external
    return null;
  },

  getStoragePath: async () => {
    return new Directory(Paths.document, MODEL_DIR_NAME).uri;
  },

  /**
   * Resets the storage to default internal directory.
   */
  resetStoragePath: async () => {
    try {
        const modelDir = new Directory(Paths.document, MODEL_DIR_NAME);
        if (modelDir.exists) await modelDir.delete();
        await modelDir.create();
    } catch (e) {
        console.error('Error resetting models:', e);
    }
  },

  /**
   * Returns a model configuration that uses the custom storage path if available.
   * This is used to check if we can skip the download.
   */
  getCustomModelConfig: (baseModel: any, customPath: string | null) => {
    return baseModel;
  },

  /**
   * Generates a response from the local LLM.
   * @param prompt The user's input/question.
   */
  generateResponse: async (prompt: string): Promise<string> => {
    try {
      // Simulation of a local LLM call using ExecuTorch
      // In production: return await LLMModule.generate(prompt);
      
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(`${prompt}`);
        }, 1000);
      });
    } catch (error) {
      console.error('LLM Inference error:', error);
      return 'I encountered an error while processing your request.';
    }
  },

  /**
   * Start voice recording and process via Speech-to-Text.
   */
  startVoiceTranscription: async () => {
    try {
      const audioCtx = new AudioContext();
      // Setup audio graph if needed
      console.log('Started voice transcription session');
    } catch (error) {
      console.error('Voice transcription error:', error);
    }
  }
};
