import { MaterialIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as FileSystem from 'expo-file-system/legacy';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { MotiView } from 'moti';
import React, { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, Image, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { AIChatButton } from '../../src/components/ai-chat';
import { useTheme } from '../../src/context/ThemeContext';
import { AppDispatch, RootState } from '../../src/store';
import { fetchModuleById, markModuleWatched, resummarizeModule } from '../../src/store/slices/learningSlice';

const { width } = Dimensions.get('window');

// Helper to extract YouTube video ID
const getYouTubeVideoId = (url: string): string | null => {
    const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[7].length === 11) ? match[7] : null;
};

// Simple context optimizer for small LLM models
const optimizeContext = (module: any) => {
    const fillers = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'at', 'on', 'with', 'which', 'that', 'this', 'these', 'those', 'from', 'this', 'that']);

    const extractKeywords = (text: string = '', limit: number = 20) => {
        const safeText = text || '';
        return safeText
            .toLowerCase()
            .replace(/[^\w\s]/g, '')
            .split(/\s+/)
            .filter(word => word.length > 3 && !fillers.has(word))
            .slice(0, limit)
            .join(' ');
    };

    const title = module.title || '';
    const desc = (module.description || '').substring(0, 150);
    const skills = (module.skillTags || []).join(', ');
    const category = module.category || 'General';
    const duration = module.duration || '';
    const summary = (module.summary || '').substring(0, 300);
    const transKeywords = extractKeywords(module.transcript, 40);

    return `Module: ${title} (${category}, ${duration}m)\nDesc: ${desc}\nSkills: ${skills}\nSummary: ${summary}\nKeywords from video: ${transKeywords}`.substring(0, 800);
};

export default function ModuleDetailScreen() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const dispatch = useDispatch<AppDispatch>();
    const insets = useSafeAreaInsets();
    const { colors } = useTheme();
    const [autoplay, setAutoplay] = useState(0);
    const [showTranscript, setShowTranscript] = useState(false);
    const [isResummarizing, setIsResummarizing] = useState(false);
    const [isStarted, setIsStarted] = useState(false);
    const [showAssessment, setShowAssessment] = useState(false);
    const scrollRef = useRef<ScrollView>(null);
    const videoSectionRef = useRef<View>(null);

    // Find module in state
    const { currentModules, learningPath, activeModule, loading, error } = useSelector((state: RootState) => state.learning);

    React.useEffect(() => {
        if (id) {
            dispatch(fetchModuleById(id as string));
        }
    }, [id, dispatch]);

    const allModules = [...(currentModules || []), ...(learningPath?.modules || [])];
    const pathModule = allModules.find(m => m.id === Number(id) || m.id === id);
    
    // Merge activeModule with pathModule to preserve derived states like isLocked/isCompleted
    const module = activeModule && (activeModule.id === Number(id) || activeModule.id === id)
        ? { ...activeModule, ...pathModule }
        : pathModule;

    const isCompleted = module?.isCompleted === true;

    const handleStartLearning = () => {
        setIsStarted(true);
        dispatch(markModuleWatched({ moduleId: id as string }));
        if (module?.format === 'video' && module?.contentUrl) {
            Linking.openURL(module.contentUrl);
        } else if (module?.contentUrl) {
            Linking.openURL(module.contentUrl);
        } else {
            Alert.alert('Coming Soon', 'This learning module will be available soon!');
        }
    };

    const handleAssessmentComplete = async () => {
        // Handled in dedicated screen now
    };

    if (loading && !module) {
        return (
            <View className="flex-1 bg-white items-center justify-center p-6">
                <MotiView
                    from={{ opacity: 0.5, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{
                        type: 'timing',
                        duration: 1000,
                        loop: true,
                    }}
                >
                    <MaterialIcons name="auto-stories" size={64} color="#3b82f6" />
                </MotiView>
                <Text className="text-lg font-medium mt-4 text-slate-500">Loading module details...</Text>
            </View>
        );
    }

    if (!module) {
        return (
            <View className="flex-1 bg-white items-center justify-center p-6">
                <MaterialIcons name="error-outline" size={64} color="#ef4444" />
                <Text className="text-xl font-bold mt-4 text-center">Module not found</Text>
                <TouchableOpacity onPress={() => router.back()} className="mt-6">
                    <Text className="text-blue-600 font-bold">Go Back</Text>
                </TouchableOpacity>
            </View>
        );
    }

    const youtubeId = module.contentUrl ? getYouTubeVideoId(module.contentUrl) : null;
    const pdfResources = module.resources || module.generationMetadata?.pdfResources || module.pdfResources || [];
    const displaySummary = module.summary || module.generationMetadata?.summaryPreview || module.summaryPreview;

    const handleDownloadResource = async (resourceUrl: string, fileName: string) => {
        try {
            const downloadResumable = FileSystem.createDownloadResumable(
                resourceUrl,
                FileSystem.documentDirectory + fileName
            );

            const result = await downloadResumable.downloadAsync();
            if (result && result.uri) {
                const canShare = await Sharing.isAvailableAsync();
                if (canShare) {
                    await Sharing.shareAsync(result.uri);
                } else {
                    Alert.alert('Success', 'File downloaded successfully!');
                }
            }
        } catch (error) {
            Alert.alert('Error', 'Failed to download resource');
            console.error(error);
        }
    };

    const handleResummarize = async () => {
        try {
            setIsResummarizing(true);
            await dispatch(resummarizeModule(module.id.toString())).unwrap();
            Alert.alert('Success', 'Module re-summarized successfully!');
        } catch (err: any) {
            Alert.alert('Error', err || 'Failed to re-summarize');
        } finally {
            setIsResummarizing(false);
        }
    };

    return (
        <View style={{ flex: 1, backgroundColor: '#f8fafc' }}>
            <ScrollView
                ref={scrollRef}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: insets.bottom + 150 }}
            >
                {/* Hero / Thumbnail section */}
                <View className="relative h-80 w-full">
                    <Image
                        source={{ uri: module.thumbnailUrl || 'https://picsum.photos/800/400' }}
                        className="w-full h-full"
                        resizeMode="cover"
                    />
                    <LinearGradient
                        colors={['rgba(0,0,0,0.4)', 'transparent', 'rgba(0,0,0,0.8)']}
                        className="absolute inset-0"
                    />

                    {/* Locked Overlay */}
                    {module.isLocked && (
                        <BlurView intensity={60} tint="dark" className="absolute inset-0 items-center justify-center">
                            <MotiView
                                from={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="bg-white/95 p-6 mx-8 rounded-[32px] items-center shadow-2xl"
                            >
                                <View className="w-16 h-16 bg-amber-100 rounded-2xl items-center justify-center mb-4">
                                    <MaterialIcons name="lock" size={32} color="#D97706" />
                                </View>
                                <Text className="text-slate-900 font-black text-xl mb-2 text-center">Locked Module</Text>
                                <Text className="text-slate-500 text-center font-medium px-2 leading-relaxed">
                                    {module.message || "Complete the previous modules in your path to unlock this lesson."}
                                </Text>
                            </MotiView>
                        </BlurView>
                    )}

                    {/* Back Button */}
                    <TouchableOpacity
                        onPress={() => router.back()}
                        style={{ top: insets.top + 10, left: 20 }}
                        className="absolute w-10 h-10 rounded-full bg-white/20 items-center justify-center border border-white/30"
                    >
                        <BlurView intensity={20} tint="light" style={StyleSheet.absoluteFill} />
                        <MaterialIcons name="arrow-back" size={24} color="white" />
                    </TouchableOpacity>

                    <View className="absolute bottom-6 left-6 right-6">
                        <View className="flex-row gap-2 mb-3">
                            <BlurView intensity={30} tint="light" className="px-3 py-1 rounded-full border border-white/20 overflow-hidden">
                                <Text className="text-white text-[10px] font-black uppercase tracking-wider">{module.difficulty}</Text>
                            </BlurView>
                            <BlurView intensity={30} tint="light" className="px-3 py-1 rounded-full border border-white/20 overflow-hidden">
                                <Text className="text-white text-[10px] font-black uppercase tracking-wider">{module.format}</Text>
                            </BlurView>
                            {module.isWatched && (
                                <BlurView intensity={40} tint="light" className="px-3 py-1 rounded-full border border-green-400/50 bg-green-500/20 overflow-hidden flex-row items-center">
                                    <MaterialIcons name="visibility" size={12} color="#4ade80" />
                                    <Text className="text-green-400 text-[10px] font-black uppercase tracking-wider ml-1">Watched</Text>
                                </BlurView>
                            )}
                        </View>
                        <Text className="text-white text-3xl font-black leading-tight shadow-sm">
                            {module.title}
                        </Text>
                    </View>
                </View>

                {/* Content section */}
                <View className="px-6 pt-8">
                    <MotiView
                        from={{ opacity: 0, translateY: 20 }}
                        animate={{ opacity: 1, translateY: 0 }}
                        transition={{ duration: 600 }}
                    >
                        {/* Skills covered - TOP */}
                        {module.skillTags && module.skillTags.length > 0 && (
                            <View className="mb-6">
                                <View className="flex-row flex-wrap gap-2">
                                    {module.skillTags.map((tag: string, i: number) => (
                                        <View key={i} className="bg-indigo-50 px-3 py-1.5 rounded-xl border border-indigo-100 flex-row items-center gap-1.5">
                                            <MaterialIcons name="check-circle" size={12} color="#4f46e5" />
                                            <Text className="text-indigo-600 font-bold text-xs capitalize">{tag}</Text>
                                        </View>
                                    ))}
                                </View>
                            </View>
                        )}

                        <Text className="text-slate-900 text-xl font-black mb-4">About this module</Text>
                        <Text className="text-slate-500 text-base leading-relaxed mb-8">
                            {module.description}
                        </Text>

                        <View className="flex-row items-center gap-6 mb-10">
                            <View className="items-center">
                                <Text className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-1">Duration</Text>
                                <Text className="text-slate-900 font-bold text-lg">{module.duration}m</Text>
                            </View>
                            <View className="w-[1px] h-8 bg-slate-200" />
                            <View className="items-center">
                                <Text className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-1">Category</Text>
                                <Text className="text-slate-900 font-bold text-lg">{module.category || 'General'}</Text>
                            </View>
                            <View className="w-[1px] h-8 bg-slate-200" />
                            <View className="items-center">
                                <Text className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-1">Type</Text>
                                <Text className="text-slate-900 font-bold text-lg capitalize">{module.format}</Text>
                            </View>
                        </View>

                        {/* Instructional Banner */}
                        {!isCompleted && isStarted && (
                            <MotiView
                                from={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="bg-indigo-600 p-6 rounded-[32px] mb-10 shadow-xl shadow-indigo-200 relative overflow-hidden"
                            >
                                <View className="flex-row items-center">
                                    <View className="w-12 h-12 bg-white/20 rounded-2xl items-center justify-center mr-4">
                                        <MaterialIcons name="auto-awesome" size={24} color="white" />
                                    </View>
                                    <View className="flex-1">
                                        <Text className="text-white font-black text-lg mb-1">Finish & Earn Points</Text>
                                        <Text className="text-indigo-100 font-medium text-xs leading-relaxed">
                                            You've started watching! Complete the AI-generated assessment to earn your completion badge and XP.
                                        </Text>
                                    </View>
                                </View>
                                <View className="absolute -bottom-4 -right-4 bg-white/10 w-24 h-24 rounded-full" />
                            </MotiView>
                        )}

                        {/* YouTube Link Section */}
                        {!module.isLocked && (module.format === 'video' || youtubeId) && module.contentUrl && (
                            <View className="mb-8">
                                <Text className="text-slate-900 text-lg font-black mb-4">Course Video</Text>
                                <TouchableOpacity
                                    onPress={() => Linking.openURL(module.contentUrl)}
                                    className="bg-red-50 p-6 rounded-3xl border border-red-100 flex-row items-center justify-between"
                                    activeOpacity={0.8}
                                >
                                    <View className="flex-row items-center flex-1 pr-4">
                                        <View className="w-14 h-14 bg-red-500 rounded-2xl items-center justify-center mr-4 shadow-lg shadow-red-200">
                                            <MaterialIcons name="play-arrow" size={32} color="white" />
                                        </View>
                                        <View className="flex-1">
                                            <Text className="text-slate-900 font-black text-sm">Watch on YouTube</Text>
                                            <Text className="text-slate-500 text-xs font-medium" numberOfLines={1}>
                                                {module.contentUrl}
                                            </Text>
                                        </View>
                                    </View>
                                    <View className="w-10 h-10 bg-white rounded-full items-center justify-center shadow-sm border border-slate-100">
                                        <MaterialIcons name="launch" size={18} color="#ef4444" />
                                    </View>
                                </TouchableOpacity>
                            </View>
                        )}

                        {/* Summary Section */}
                        {(module.summary || !module.isLocked) && (
                            <View className="mb-8 p-6 bg-indigo-50/50 rounded-3xl border border-indigo-100">
                                <View className="flex-row items-center justify-between mb-3">
                                    <View className="flex-row items-center gap-2">
                                        <MaterialIcons name="summarize" size={20} color="#4f46e5" />
                                        <Text className="text-indigo-900 text-lg font-black">AI Summary</Text>
                                    </View>
                                    {!module.isLocked && (
                                        <TouchableOpacity
                                            onPress={handleResummarize}
                                            disabled={isResummarizing}
                                            className="w-10 h-10 rounded-full bg-white/50 items-center justify-center border border-indigo-100"
                                        >
                                            {isResummarizing ? (
                                                <ActivityIndicator size="small" color="#4f46e5" />
                                            ) : (
                                                <MaterialIcons name="refresh" size={20} color="#4f46e5" />
                                            )}
                                        </TouchableOpacity>
                                    )}
                                </View>
                                {displaySummary ? (
                                    <Markdown
                                        style={{
                                            body: { color: '#475569', fontSize: 16, lineHeight: 24, fontStyle: 'italic' },
                                            strong: { color: '#1e293b', fontWeight: 'bold' },
                                            bullet_list: { marginTop: 10 },
                                            list_item: { marginVertical: 4 }
                                        }}
                                    >
                                        {displaySummary}
                                    </Markdown>
                                ) : (
                                    <Text className="text-slate-400 italic">Summary is being generated...</Text>
                                )}
                            </View>
                        )}

                        {/* Transcript Section */}
                        {!module.isLocked && module.transcript && (
                            <View className="mb-8 p-6 bg-slate-50 rounded-3xl border border-slate-200">
                                <TouchableOpacity
                                    onPress={() => setShowTranscript(!showTranscript)}
                                    className="flex-row items-center justify-between"
                                    activeOpacity={0.7}
                                >
                                    <View className="flex-row items-center gap-2">
                                        <MaterialIcons name="description" size={20} color="#64748b" />
                                        <Text className="text-slate-900 text-lg font-black">Video Transcript</Text>
                                    </View>
                                    <MaterialIcons
                                        name={showTranscript ? "expand-less" : "expand-more"}
                                        size={24}
                                        color="#64748b"
                                    />
                                </TouchableOpacity>

                                {showTranscript && (
                                    <MotiView
                                        from={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        transition={{ type: 'timing', duration: 300 }}
                                        className="mt-4 pt-4 border-t border-slate-200"
                                    >
                                        <Markdown
                                            style={{
                                                body: { color: '#475569', fontSize: 14, lineHeight: 22 },
                                                strong: { color: '#0f172a', fontWeight: 'bold' }
                                            }}
                                        >
                                            {module.transcript}
                                        </Markdown>
                                    </MotiView>
                                )}
                            </View>
                        )}

                        {/* Resources Section */}
                        {!module.isLocked && pdfResources && pdfResources.length > 0 && (
                            <View className="mb-8">
                                <Text className="text-slate-900 text-lg font-black mb-4">Resources</Text>
                                {pdfResources.map((resource: any, index: number) => (
                                    <View key={index} className="bg-white/80 rounded-2xl p-4 mb-3 border border-white shadow-sm overflow-hidden">
                                        <BlurView intensity={10} tint="light" style={StyleSheet.absoluteFill} />
                                        <View className="flex-row items-center justify-between">
                                            <View className="flex-row items-center flex-1 mr-4">
                                                <View className="w-12 h-12 rounded-xl bg-red-100 items-center justify-center mr-3">
                                                    <MaterialIcons name="picture-as-pdf" size={24} color="#ef4444" />
                                                </View>
                                                <View className="flex-1">
                                                    <Text className="text-slate-900 font-black text-sm" numberOfLines={1}>
                                                        {resource.title || `Resource ${index + 1}`}
                                                    </Text>
                                                    <Text className="text-slate-400 text-xs font-bold uppercase tracking-tighter">PDF Document</Text>
                                                </View>
                                            </View>
                                            <TouchableOpacity
                                                onPress={() => handleDownloadResource(resource.url || resource.link, resource.title ? `${resource.title}.pdf` : `resource_${index + 1}.pdf`)}
                                                className="w-10 h-10 rounded-xl bg-blue-500 items-center justify-center shadow-md shadow-blue-200"
                                            >
                                                <MaterialIcons name="download" size={20} color="white" />
                                            </TouchableOpacity>
                                        </View>
                                    </View>
                                ))}
                            </View>
                        )}
                    </MotiView>
                </View>
            </ScrollView>

            {/* STICKY BOTTOM BUTTON */}
            <View
                className="absolute bottom-0 left-0 right-0 bg-white/80 p-6 px-8 border-t border-slate-100"
                style={{ paddingBottom: Math.max(insets.bottom, 24) }}
            >
                <BlurView intensity={30} tint="light" style={StyleSheet.absoluteFill} />
                {isCompleted ? (
                    <View className="bg-green-50 py-4 px-6 rounded-2xl flex-row items-center justify-center border border-green-100">
                        <MaterialIcons name="check-circle" size={24} color="#16a34a" />
                        <Text className="text-green-700 font-black text-lg ml-2 uppercase tracking-widest">Completed</Text>
                    </View>
                ) : (
                    <PrimaryButton
                        title={module.isLocked ? "Locked" : (isStarted ? "Assess My Learning" : `Start ${module.format === 'video' ? 'Watching' : 'Learning'}`)}
                        iconName={module.isLocked ? "lock" : (isStarted ? "assignment-turned-in" : (module.format === 'video' ? 'play-arrow' : 'auto-stories'))}
                        onPress={module.isLocked ? () => { } : (isStarted ? () => router.push(`/modules/assessment/${id}`) : handleStartLearning)}
                        disabled={module.isLocked}
                    />
                )}
            </View>

            <AIChatButton
                position={{ bottom: insets.bottom + 130, right: 20 }}
                mode="adult"
                context={optimizeContext(module)}
            />
        </View>
    );
}
