import { Paths, Directory, File } from 'expo-file-system';
import { LLMModule, SpeechToTextModule, TokenizerModule, VADModule } from 'react-native-executorch';

/**
 * Interface representing an AI interaction result.
 */
export interface ChatMessage {
    id: string;
    text: string;
    sender: 'user' | 'ai';
    timestamp: number;
}

const CONFIG_FILE_NAME = 'ai_storage_config.json';
const MODEL_DIR_NAME = 'ai_models';
let isInitialized = false;

/**
 * Service to handle on-device AI operations including 
 * Local LLM inference and Speech-to-Text using ExecuTorch.
 */
export const aiService = {
  initialize: async () => {
    if (isInitialized) return;
    try {
      const customPath = await aiService.getStoragePath();
      
      // If no custom path, ensure default model directory exists in documentDirectory
      if (!customPath) {
        const modelDir = new Directory(Paths.document, MODEL_DIR_NAME);
        if (!modelDir.exists) {
            await modelDir.create({ idempotent: true });
        }
      }
      
      isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize AI service directory:', error);
    }
  },

  /**
   * Checks for free space and downloads the model parts manually to ensure persistence
   * and avoid the 'No space left' error caused by internal library movement.
   */
  ensureModelDownloaded: async (modelConfig: any, onProgress?: (p: number) => void) => {
    const customPath = await aiService.getStoragePath();
    const baseDirUri = customPath || `${Paths.document.uri}${MODEL_DIR_NAME}/`;
    
    // 1. Dynamic space check based on model size
    // Llama 3.2 1B is ~1.2GB, LFM 350M is ~300MB, SmollM 135M is ~150MB
    let requiredBytes = 1.3 * 1024 * 1024 * 1024; // Default to 1.3GB
    if (modelConfig.modelName?.includes('350m')) requiredBytes = 400 * 1024 * 1024;
    if (modelConfig.modelName?.includes('135m')) requiredBytes = 200 * 1024 * 1024;
    if (modelConfig.modelName?.includes('0.5b')) requiredBytes = 600 * 1024 * 1024;

    const freeSpace = Paths.availableDiskSpace;
    
    const filesToDownload = [
        { key: 'modelSource', url: modelConfig.modelSource },
        { key: 'tokenizerSource', url: modelConfig.tokenizerSource },
        { key: 'tokenizerConfigSource', url: modelConfig.tokenizerConfigSource },
    ];

    const localPaths: any = { ...modelConfig };
    let completedFiles = 0;

    for (const file of filesToDownload) {
        const fileName = typeof file.url === 'string' ? file.url.split('/').pop()! : `file_${file.key}`;
        
        // Create a File instance for the target location
        const targetFile = new File(baseDirUri, fileName);
        
        if (targetFile.exists) {
            console.log(`File already exists: ${fileName}`);
            localPaths[file.key] = targetFile.uri;
            completedFiles++;
            continue;
        }

        // Only check space if we actually need to download something
        if (freeSpace < requiredBytes) {
            throw new Error(`Insufficient storage. Need ~1.3GB, but only ${Math.round(freeSpace / 1024 / 1024)}MB available.`);
        }

        console.log(`Downloading ${fileName}...`);
        
        try {
            // Use the new static download method
            const downloaded = await File.downloadFileAsync(
                file.url,
                targetFile,
                { idempotent: true }
            );
            
            localPaths[file.key] = downloaded.uri;
            completedFiles++;
            
            // Basic progress reporting (per file)
            onProgress?.(completedFiles / filesToDownload.length);
        } catch (error) {
            console.error(`Download failed for ${fileName}:`, error);
            throw error;
        }
    }

    return localPaths;
  },

  /**
   * Allows the user to pick a custom directory for AI model storage using modern API.
   */
  pickCustomDirectory: async () => {
    try {
      const directory = await Directory.pickDirectoryAsync();
      if (directory) {
        const configFile = new File(Paths.document, CONFIG_FILE_NAME);
        await configFile.write(JSON.stringify({ path: directory.uri }));
        console.log('User selected custom directory:', directory.uri);
        return directory.uri;
      }
      return null;
    } catch (error) {
      console.error('Error picking directory:', error);
      return null;
    }
  },

  getStoragePath: async () => {
    try {
        const configFile = new File(Paths.document, CONFIG_FILE_NAME);
        if (configFile.exists) {
            const content = await configFile.text();
            const config = JSON.parse(content);
            return config.path;
        }
    } catch (e) {
        console.log('No custom storage config found.');
    }
    return null;
  },

  /**
   * Resets the storage to default internal directory.
   */
  resetStoragePath: async () => {
    try {
        const configFile = new File(Paths.document, CONFIG_FILE_NAME);
        if (configFile.exists) {
            await configFile.delete();
        }
        isInitialized = false;
        await aiService.initialize();
    } catch (e) {
        console.error('Error resetting storage path:', e);
    }
  },

  /**
   * Returns a model configuration that uses the custom storage path if available.
   * This allows caching the model in a user-selected folder and reusing it.
   */
  getCustomModelConfig: (baseModel: any, customPath: string | null) => {
    if (!customPath) return baseModel;

    // Helper to get filename from source URL
    const getFileName = (source: string | any) => {
      if (typeof source === 'string') {
        return source.split('/').pop() || 'file';
      }
      return 'model_file';
    };

    return {
      ...baseModel,
      modelSource: `${customPath}${getFileName(baseModel.modelSource)}`,
      tokenizerSource: `${customPath}${getFileName(baseModel.tokenizerSource)}`,
      tokenizerConfigSource: `${customPath}${getFileName(baseModel.tokenizerConfigSource)}`,
    };
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
