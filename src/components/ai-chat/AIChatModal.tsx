import { MaterialIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { MotiView } from 'moti';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { AudioManager, AudioRecorder } from 'react-native-audio-api';
import { LFM2_5_350M, useLLM, useSpeechToText, WHISPER_TINY_EN } from 'react-native-executorch';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Markdown from 'react-native-markdown-display';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { aiService } from '../../services/aiService';

/* 
 * AIChatModal Component
 * 
 * Displays the chat interface with the AI mentor.
 * Supports different themes/modes via props if needed, or uses a neutral/adaptive style.
 */

interface AIChatModalProps {
    visible: boolean;
    onClose: () => void;
    mode?: 'adult' | 'kid'; // To adjust tone/style if needed
    context?: string;
}

interface ChatMessage {
    id: string;
    text: string;
    sender: 'user' | 'ai';
    timestamp: number;
}

export const AIChatModal = ({ visible, onClose, mode = 'adult', context }: AIChatModalProps) => {
    const insets = useSafeAreaInsets();
    const [inputText, setInputText] = useState('');
    const [messages, setMessages] = useState<ChatMessage[]>([
        {
            id: '1',
            text: `Hi there! 👋 I'm your Skill Compass Mentor. What amazing thing do you want to learn about today? 🚀`,
            sender: 'ai',
            timestamp: Date.now(),
        },
    ]);
    const [isTyping, setIsTyping] = useState(false);
    const [committedTranscription, setCommittedTranscription] = useState('');
    const [nonCommittedTranscription, setNonCommittedTranscription] = useState('');
    const [isWhisperRequired, setIsWhisperRequired] = useState(false);
    const [localLlmConfig, setLocalLlmConfig] = useState<any>(null);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [isDownloading, setIsDownloading] = useState(false);
    const [sttStatus, setSttStatus] = useState<'idle' | 'listening' | 'converting'>('idle');

    // Initial check for models
    React.useEffect(() => {
        const prepareModel = async () => {
            setIsDownloading(true);
            try {
                // We pass the default remote config, and the service returns local paths
                const config = await aiService.ensureModelDownloaded(LFM2_5_350M, (p) => {
                    setDownloadProgress(p);
                });
                setLocalLlmConfig(config);
            } catch (error) {
                console.error('Failed to prepare AI model:', error);
            } finally {
                setIsDownloading(false);
            }
        };
        prepareModel();
    }, []);

    // Memoize model configurations
    const sttConfig = React.useMemo(() => ({
        model: WHISPER_TINY_EN,
        preventLoad: !isWhisperRequired,
    }), [isWhisperRequired]);

    const llmConfig = React.useMemo(() => ({
        model: localLlmConfig || LFM2_5_350M,
        preventLoad: !localLlmConfig, // Don't load until we have local paths
    }), [localLlmConfig]);

    // AI STT (Whisper) model
    // @ts-ignore
    const sttModel = useSpeechToText(sttConfig);

    // Initialize the LLM Model 🚀
    const llm = useLLM(llmConfig);

    const [recorder] = useState(() => new AudioRecorder());

    React.useEffect(() => {
        if (visible) {
            AudioManager.setAudioSessionOptions({
                iosCategory: 'playAndRecord',
                iosMode: 'spokenAudio',
                iosOptions: ['allowBluetoothHFP', 'defaultToSpeaker'],
            });
            AudioManager.requestRecordingPermissions();
        }
    }, [visible]);

    const handleStartStreaming = async () => {
        setIsWhisperRequired(true);
        
        if (!sttModel.isReady) {
            setSttStatus('converting'); // Show the ActivityIndicator overlay
            // Poll for readiness or just give a moment - actually we should check if it's already loading
            return; 
        }

        setSttStatus('listening');
        setCommittedTranscription('');
        setNonCommittedTranscription('');

        recorder.onAudioReady(
            { sampleRate: 16000, bufferLength: 1600, channelCount: 1 },
            ({ buffer }) => {
                sttModel.streamInsert(buffer.getChannelData(0));
            }
        );

        recorder.start();

        try {
            for await (const result of sttModel.stream()) {
                setCommittedTranscription(result.committed.text);
                setNonCommittedTranscription(result.nonCommitted.text);
            }
        } catch (error) {
            console.error('Transcription error:', error);
            handleStopStreaming();
        }
    };

    const handleStopStreaming = async () => {
        setSttStatus('converting');
        recorder.stop();
        sttModel.streamStop();

        // Give a tiny moment for final buffers to process
        setTimeout(() => {
            if (committedTranscription) {
                setInputText(prev => prev + (prev ? ' ' : '') + committedTranscription);
            }
            setSttStatus('idle');
            setCommittedTranscription('');
            setNonCommittedTranscription('');
        }, 500);
    };

    const handleSend = async () => {
        if (!inputText.trim() || !llm.isReady) return;

        const userMsg: ChatMessage = {
            id: Date.now().toString(),
            text: inputText,
            sender: 'user',
            timestamp: Date.now(),
        };

        setMessages((prev) => [...prev, userMsg]);
        const currentInput = inputText;
        setInputText('');
        setIsTyping(true);

        try {
            // Map existing messages to LLM format
            const chatHistory = messages.map(m => ({
                role: (m.sender === 'user' ? 'user' : 'assistant') as any,
                content: m.text
            }));

            const basePrompt = mode === 'kid'
                ? 'You are a friendly Skill Compass Mentor for kids. Be very concise, use simple words, and lots of emojis! Use Markdown for **bold** key words. Always answer in English only.'
                : 'You are a professional Skill Compass Mentor. Use Markdown (bold, lists) for structure. Provide professional, concise, and actionable advice. Always answer in English only.';

            const contextPrompt = context 
                ? `\n\nContext regarding the current module: ${context}\nUse this context to provide highly relevant answers about the specific topic being learned.`
                : '';

            const systemPrompt = basePrompt + contextPrompt;

            const historyWithSystem = [
                { role: 'system' as any, content: systemPrompt },
                ...chatHistory,
                { role: 'user' as any, content: currentInput }
            ];

            // On-device AI inference 🚀 - This will update llm.response in real-time
            const fullResponse = await llm.generate(historyWithSystem);

            // Once finished, add the final response to the messages array
            // Use the returned fullResponse to ensure we don't catch an empty state
            const aiMsg: ChatMessage = {
                id: (Date.now() + 1).toString(),
                text: fullResponse || llm.response || "I'm sorry, I couldn't process that.",
                sender: 'ai',
                timestamp: Date.now(),
            };
            setMessages((prev) => [...prev, aiMsg]);
        } catch (error) {
            console.error('LLM Inference error:', error);
            const aiResponseText = await aiService.generateResponse(currentInput);
            setMessages((prev) => [...prev, {
                id: (Date.now() + 1).toString(),
                text: aiResponseText,
                sender: 'ai',
                timestamp: Date.now(),
            }]);
        } finally {
            setIsTyping(false);
        }
    };

    const handleStorageSettings = async () => {
        const newPath = await aiService.pickCustomDirectory();
        if (newPath) {
            // Reload the app or just alert
            alert('Storage path updated! Please reload the app to apply changes.');
        }
    };

    const handleCopy = async (text: string) => {
        await Clipboard.setStringAsync(text);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    };

    const markdownRules = {
        fence: (node: any, children: any, parent: any, styles: any) => {
            return (
                <View key={node.key} className="my-2 bg-slate-900 rounded-xl overflow-hidden">
                    <View className="flex-row items-center justify-between px-4 py-2 bg-slate-800">
                        <Text className="text-slate-400 text-xs font-bold uppercase tracking-widest">Code</Text>
                        <TouchableOpacity 
                            onPress={() => handleCopy(node.content)}
                            className="flex-row items-center gap-1"
                        >
                            <MaterialIcons name="content-copy" size={14} color="#94A3B8" />
                            <Text className="text-slate-400 text-xs font-bold">Copy</Text>
                        </TouchableOpacity>
                    </View>
                    <View className="p-4">
                        <Text className="text-blue-300 font-mono text-xs">{node.content}</Text>
                    </View>
                </View>
            );
        },
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <MotiView
                from={{ opacity: 0, translateY: 100 }}
                animate={{ opacity: 1, translateY: 0 }}
                exit={{ opacity: 0, translateY: 100 }}
                style={{
                    flex: 1,
                    backgroundColor: 'rgba(0,0,0,0.5)'
                }}
            >
                <BlurView intensity={20} tint="light" style={{ flex: 1 }}>
                    <KeyboardAvoidingView
                        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                        style={{ flex: 1 }}
                    >
                        <View className="flex-1 bg-white/95 mt-10 rounded-t-[32px] overflow-hidden shadow-2xl">
                            {/* Header */}
                            <View className="flex-row items-center justify-between p-4 border-b border-slate-100 bg-white">
                                <View className="flex-row items-center gap-3">
                                    <View className="w-10 h-10 rounded-full bg-indigo-100 items-center justify-center">
                                        <MaterialIcons name="smart-toy" size={24} color="#4F46E5" />
                                    </View>
                                    <View>
                                        <Text className="font-bold text-slate-800 text-lg">Skill Compass Mentor</Text>
                                        <View className="flex-row items-center gap-1">
                                            <View className={`w-2 h-2 rounded-full ${llm.isReady ? 'bg-green-500' : 'bg-orange-500'}`} />
                                            <Text className="text-xs text-slate-500 font-medium">
                                                {llm.isReady ? 'Ready to help' : (isDownloading ? `Downloading (${Math.round(downloadProgress * 100)}%)` : 'Initializing...')}
                                            </Text>
                                        </View>
                                    </View>
                                </View>
                                <View className="flex-row items-center gap-2">
                                    <TouchableOpacity
                                        onPress={handleStorageSettings}
                                        className="w-10 h-10 rounded-full bg-slate-100 items-center justify-center"
                                    >
                                        <MaterialIcons name="storage" size={22} color="#64748B" />
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        onPress={() => {
                                            Keyboard.dismiss();
                                            onClose();
                                        }}
                                        className="w-10 h-10 rounded-full bg-slate-100 items-center justify-center"
                                    >
                                        <MaterialIcons name="close" size={24} color="#64748B" />
                                    </TouchableOpacity>
                                </View>
                            </View>

                            {/* Chat Area */}
                            <ScrollView
                                className="flex-1 px-4 py-4"
                                contentContainerStyle={{ paddingBottom: 20 }}
                                ref={(ref) => ref?.scrollToEnd({ animated: true })}
                            >
                                {messages.map((msg) => (
                                    <View
                                        key={msg.id}
                                        className={`mb-4 max-w-[85%] ${msg.sender === 'user' ? 'self-end' : 'self-start'}`}
                                    >
                                        <View
                                            className={`p-4 rounded-2xl ${msg.sender === 'user'
                                                ? 'bg-blue-600 rounded-tr-none'
                                                : 'bg-slate-100 rounded-tl-none'
                                                }`}
                                        >
                                            {/* Unified Copy Button for full message - Animated Entry after generation */}
                                            <MotiView
                                                from={{ opacity: 0, scale: 0.5 }}
                                                animate={{ opacity: 1, scale: 1 }}
                                                transition={{ type: 'spring', delay: 300 }}
                                                className="absolute top-2 right-2 z-20"
                                            >
                                                <TouchableOpacity 
                                                    onPress={() => handleCopy(msg.text)}
                                                    className="w-8 h-8 rounded-full items-center justify-center bg-black/5"
                                                    activeOpacity={0.6}
                                                >
                                                    <MaterialIcons name="content-copy" size={14} color={msg.sender === 'user' ? 'white' : '#64748B'} />
                                                </TouchableOpacity>
                                            </MotiView>

                                            {msg.sender === 'user' ? (
                                                <Text className="text-white text-base pr-6">{msg.text}</Text>
                                            ) : (
                                                <Markdown
                                                    rules={markdownRules}
                                                    style={{
                                                        body: { color: '#1e293b', fontSize: 16 },
                                                        paragraph: { marginVertical: 0 },
                                                        bullet_list: { marginVertical: 4 },
                                                        ordered_list: { marginVertical: 4 },
                                                        strong: { fontWeight: '700', color: '#4F46E5' },
                                                        heading1: { fontSize: 20, fontWeight: 'bold', marginBottom: 4 },
                                                        heading2: { fontSize: 18, fontWeight: 'bold', marginBottom: 4 },
                                                    }}
                                                >
                                                    {msg.text}
                                                </Markdown>
                                            )}
                                        </View>
                                        <Text className="text-[10px] text-slate-400 mt-1 px-1">
                                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </Text>
                                    </View>
                                ))}

                                 {/* Live Streaming Message */}
                                {llm.isGenerating && (
                                    <View className="self-start mb-4 max-w-[85%]">
                                        <View className="bg-slate-100 p-4 rounded-2xl rounded-tl-none relative">
                                            <Markdown
                                                rules={markdownRules}
                                                style={{
                                                    body: { color: '#1e293b', fontSize: 16 },
                                                    paragraph: { marginVertical: 0 },
                                                    strong: { fontWeight: '700', color: '#4F46E5' },
                                                }}
                                            >
                                                {llm.response}
                                            </Markdown>
                                            <View className="flex-row gap-1 mt-2">
                                                <MotiView
                                                    from={{ opacity: 0.3 }}
                                                    animate={{ opacity: 1 }}
                                                    transition={{ loop: true, duration: 600, delay: 0 }}
                                                    className="w-1.5 h-1.5 rounded-full bg-slate-400"
                                                />
                                                <MotiView
                                                    from={{ opacity: 0.3 }}
                                                    animate={{ opacity: 1 }}
                                                    transition={{ loop: true, duration: 600, delay: 200 }}
                                                    className="w-1.5 h-1.5 rounded-full bg-slate-400"
                                                />
                                                <MotiView
                                                    from={{ opacity: 0.3 }}
                                                    animate={{ opacity: 1 }}
                                                    transition={{ loop: true, duration: 600, delay: 400 }}
                                                    className="w-1.5 h-1.5 rounded-full bg-slate-400"
                                                />
                                            </View>
                                        </View>
                                    </View>
                                )}
                            </ScrollView>

                            {/* Input Area */}
                            <View
                                className="p-4 border-t border-slate-100 bg-white"
                                style={{ paddingBottom: insets.bottom + 10 }}
                            >
                                {/* Transcription overlay while recording/converting */}
                                {sttStatus !== 'idle' && (
                                    <MotiView 
                                        from={{ opacity: 0, scale: 0.8, translateY: 10 }}
                                        animate={{ opacity: 1, scale: 1, translateY: 0 }}
                                        className="absolute bottom-24 left-4 right-4 z-50 shadow-2xl"
                                    >
                                        <BlurView intensity={90} tint="dark" className="rounded-[32px] p-6 flex-row items-center border border-white/20 overflow-hidden">
                                            {sttStatus === 'listening' ? (
                                                <>
                                                    <View className="flex-1 mr-4">
                                                        <View className="flex-row items-center gap-2 mb-2">
                                                            <MotiView
                                                                from={{ opacity: 0.3 }}
                                                                animate={{ opacity: 1 }}
                                                                transition={{ loop: true, duration: 600 }}
                                                                className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-sm shadow-red-500"
                                                            />
                                                            <Text className="text-white/80 text-[11px] font-black uppercase tracking-widest">Listening...</Text>
                                                        </View>
                                                        <Text className="text-white font-bold text-lg leading-tight">
                                                            {committedTranscription || 'Start speaking...'}{' '}
                                                            <Text className="text-white/40 italic font-medium">{nonCommittedTranscription}</Text>
                                                        </Text>
                                                    </View>
                                                    <TouchableOpacity 
                                                        onPress={handleStopStreaming}
                                                        className="w-14 h-14 rounded-full bg-green-500 items-center justify-center shadow-lg shadow-green-900/20"
                                                    >
                                                        <MaterialIcons name="check" size={32} color="white" />
                                                    </TouchableOpacity>
                                                </>
                                            ) : (
                                                <View className="flex-1 flex-row items-center justify-center gap-4 py-2">
                                                    <ActivityIndicator size="large" color="#ffffff" />
                                                    <Text className="text-white font-black text-lg tracking-tight">Converting your voice...</Text>
                                                </View>
                                            )}
                                        </BlurView>
                                    </MotiView>
                                )}

                                <View className="flex-row items-center gap-2 bg-slate-50 p-2 rounded-full border border-slate-200">
                                    <TextInput
                                        className="flex-1 px-4 py-2 text-base text-slate-800 font-medium"
                                        placeholder={isDownloading ? `Preparing AI... ${Math.round(downloadProgress * 100)}%` : (!llm.isReady ? "Initializing model..." : (isWhisperRequired && !sttModel.isReady ? "Loading Whisper..." : "Ask me anything..."))}
                                        placeholderTextColor="#94A3B8"
                                        value={inputText}
                                        onChangeText={setInputText}
                                        multiline
                                        maxLength={200}
                                        editable={llm.isReady}
                                    />

                                    {/* Voice Button */}
                                    <TouchableOpacity
                                        onPress={sttModel.isGenerating ? handleStopStreaming : handleStartStreaming}
                                        disabled={!llm.isReady || (isWhisperRequired && !sttModel.isReady)}
                                        className={`w-10 h-10 rounded-full items-center justify-center ${sttModel.isGenerating ? 'bg-red-500' : 'bg-slate-200'
                                            }`}
                                    >
                                        <MaterialIcons
                                            name={sttModel.isGenerating ? "stop" : "mic"}
                                            size={20}
                                            color={sttModel.isGenerating ? "white" : "#4F46E5"}
                                        />
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        onPress={handleSend}
                                        disabled={!inputText.trim() || isTyping || !llm.isReady}
                                        className={`w-10 h-10 rounded-full items-center justify-center ${inputText.trim() && !isTyping && llm.isReady ? 'bg-blue-600' : 'bg-slate-300'
                                            }`}
                                    >
                                        <MaterialIcons name="send" size={20} color="white" />
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </View>
                    </KeyboardAvoidingView>
                </BlurView>
            </MotiView>
        </Modal>
    );
};
