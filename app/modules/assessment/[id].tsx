import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { MotiView, AnimatePresence } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import { useLLM, LFM2_5_350M } from 'react-native-executorch';
import { AppDispatch, RootState } from '../../../src/store';
import { completeModule, fetchMyLearningPath } from '../../../src/store/slices/learningSlice';

interface Question {
    id: string;
    type: 'quiz' | 'qa' | 'essay';
    text: string;
    options?: string[]; // For quiz
    answer: string; // User input
}

export default function AssessmentScreen() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const dispatch = useDispatch<AppDispatch>();
    
    // Get module from state
    const { currentModules, learningPath, activeModule } = useSelector((state: RootState) => state.learning);
    const allModules = [...(currentModules || []), ...(learningPath?.modules || [])];
    const module = (activeModule && (activeModule.id === Number(id) || activeModule.id === id))
        ? activeModule
        : allModules.find(m => m.id === Number(id) || m.id === id);

    const [status, setStatus] = useState<'choosing' | 'generating' | 'answering' | 'evaluating' | 'completed'>('choosing');
    const [testType, setTestType] = useState<'quiz' | 'qa' | 'essay' | 'mixed'>('quiz');
    const [aiLog, setAiLog] = useState('Initializing Local AI...');
    const [questions, setQuestions] = useState<Question[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [evaluationResult, setEvaluationResult] = useState<{ passed: boolean; feedback: string; score?: number } | null>(null);

    const llm = useLLM({
        model: LFM2_5_350M,
    });

    const startGeneration = async (type: typeof testType) => {
        setTestType(type);
        setStatus('generating');
        setAiLog('Analyzing module content to craft questions...');

        try {
            if (!llm.isReady) {
                setAiLog('Waiting for AI Model to warm up...');
                let retries = 0;
                while (!llm.isReady && retries < 20) {
                    await new Promise(r => setTimeout(r, 1000));
                    retries++;
                }
            }

            const constraints = type === 'quiz' ? 'min 6, max 15 questions' : (type === 'qa' ? 'min 5, max 15 questions' : '1 or 2 essay prompts');
            
            const systemPrompt = "You are a specialized Assessment Engine. You must return ONLY raw JSON. Do not include any introductory or concluding text. Your output must be a valid JSON array of objects.";
            
            const prompt = `[CONTEXT] Module: ${module?.title}. Description: ${module?.description}. [CONSTRAINTS] Type: ${type}, Quantity: ${constraints}. [INSTRUCTION] Generate a set of questions. Format: [{"type": "quiz"|"qa"|"essay", "text": "...", "options": ["...", "..."] (only for quiz)}]. Return ONLY the JSON array starting with [ and ending with ].`;
            
            const response = await llm.generate([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt }
            ]);
            
            // SUPER ROBUST JSON extraction
            let jsonString = response.trim();
            const firstBracket = jsonString.indexOf('[');
            const lastBracket = jsonString.lastIndexOf(']');
            
            if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
                jsonString = jsonString.substring(firstBracket, lastBracket + 1);
            }

            const parsed = JSON.parse(jsonString);
            
            // Enforce hard max of 15 if AI went crazy
            const formatted = parsed.slice(0, 15).map((q: any, i: number) => ({
                ...q,
                id: `q-${i}`,
                answer: ''
            }));
            
            setQuestions(formatted);
            setStatus('answering');
        } catch (error) {
            console.error('Generation error:', error);
            Alert.alert('AI Data Error', 'The local AI provided an unstructured response. Retrying with stricter constraints...');
            setStatus('choosing');
        }
    };

    const handleAnswerChange = (text: string) => {
        const updated = [...questions];
        updated[currentIndex].answer = text;
        setQuestions(updated);
    };

    const nextQuestion = () => {
        if (currentIndex < questions.length - 1) {
            setCurrentIndex(prev => prev + 1);
        } else {
            evaluateAll();
        }
    };

    const evaluateAll = async () => {
        setStatus('evaluating');
        setAiLog('Local AI is reviewing your responses...');

        try {
            const context = questions.map((q, i) => `[Question ${i+1}] ${q.text}\n[User Answer] ${q.answer}`).join('\n\n');
            const systemPrompt = "You are a Strict and Critical Subject Matter Expert. Your job is to strictly evaluate if the user understands the topic. If answers are lazy, incorrect, or irrelevant, you MUST fail them. Return ONLY raw JSON.";
            const evalPrompt = `[MODULE] ${module?.title}\n[RESPONSES]\n${context}\n\n[GRADING RULES]\n1. Be highly critical. If any significant part is wrong, set passed: false.\n2. Answers like "don't know", "." or random letters must fail.\n3. Return ONLY this format: {"passed": boolean, "feedback": "Why did they pass/fail?", "score": number}.\n\n[RESULT]`;
            
            const response = await llm.generate([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: evalPrompt }
            ]);
            
            let jsonString = response.trim();
            const firstBrace = jsonString.indexOf('{');
            const lastBrace = jsonString.lastIndexOf('}');
            
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
                jsonString = jsonString.substring(firstBrace, lastBrace + 1);
            }

            const result = JSON.parse(jsonString);
            setEvaluationResult(result);
            
            if (result.passed) {
                await dispatch(completeModule({
                    moduleId: id as string,
                    testResults: {
                        score: result.score || 100,
                        questions: questions.map(q => ({ q: q.text, a: q.answer })),
                        feedback: result.feedback
                    }
                })).unwrap();
                
                // Refresh learning path to show unlocked next module
                await dispatch(fetchMyLearningPath());
            }
            setStatus('completed');
        } catch (error) {
            console.error('Evaluation error:', error);
            setStatus('answering');
            Alert.alert('Analysis Failed', 'There was a problem evaluating your answers. Please try submitting again.');
        }
    };

    const currentQuestion = questions[currentIndex];

    // CHOOSING SCREEN
    if (status === 'choosing') {
        return (
            <View className="flex-1 bg-white">
                <View className="px-8 pt-16 pb-8 flex-row items-center justify-between">
                    <View>
                        <Text className="text-slate-400 text-[10px] font-black uppercase tracking-[3px] mb-1">Step 1: Choose</Text>
                        <Text className="text-3xl font-black text-slate-900">Test Format</Text>
                    </View>
                    <TouchableOpacity onPress={() => router.back()} className="w-12 h-12 rounded-2xl bg-slate-50 items-center justify-center">
                        <Ionicons name="close" size={24} color="#64748b" />
                    </TouchableOpacity>
                </View>

                <ScrollView className="flex-1 px-8">
                    <Text className="text-slate-500 font-medium mb-10 leading-relaxed text-base">
                        Select how you'd like your local AI to challenge you today. Each format is uniquely generated for this lesson.
                    </Text>

                    {[
                        { id: 'quiz', title: 'Multiple Choice', icon: 'list', desc: 'Fast, binary knowledge check', color: '#EC4899' },
                        { id: 'qa', title: 'Practical Q&A', icon: 'chatbubbles', desc: 'Direct, focused questions', color: '#10B981' },
                        { id: 'essay', title: 'Deep Explanation', icon: 'document-text', desc: 'Critical thinking & concepts', color: '#F59E0B' }
                    ].map((item) => (
                        <TouchableOpacity 
                            key={item.id}
                            onPress={() => startGeneration(item.id as any)}
                            className="bg-slate-50 p-6 rounded-[32px] border border-slate-100 mb-4 flex-row items-center"
                        >
                            <View className="w-14 h-14 bg-white rounded-2xl items-center justify-center shadow-sm mr-5">
                                <Ionicons name={item.icon as any} size={28} color={item.color} />
                            </View>
                            <View className="flex-1">
                                <Text className="text-slate-900 font-black text-lg">{item.title}</Text>
                                <Text className="text-slate-400 text-xs font-bold">{item.desc}</Text>
                            </View>
                            <MaterialIcons name="chevron-right" size={24} color="#CBD5E1" />
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>
        );
    }

    if (status === 'generating' || status === 'evaluating') {
        return (
            <View className="flex-1 bg-slate-900 justify-center items-center p-10">
                <TouchableOpacity 
                    onPress={() => setStatus('choosing')}
                    className="absolute top-12 right-12 w-12 h-12 rounded-full bg-white/10 items-center justify-center border border-white/20"
                >
                    <Ionicons name="close" size={24} color="white" />
                </TouchableOpacity>

                <MotiView
                    from={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ loop: true, type: 'timing', duration: 1500 }}
                    className="w-40 h-40 rounded-full border-4 border-indigo-500 items-center justify-center mb-10"
                >
                    <Ionicons name="hardware-chip" size={60} color="#6366f1" />
                </MotiView>
                <Text className="text-white font-black text-2xl text-center mb-2 tracking-tight">AI Thinking...</Text>
                <Text className="text-indigo-400 font-medium text-center uppercase tracking-[2px] text-[10px]">{aiLog}</Text>
                <View className="w-64 mt-12 h-1 bg-slate-800 rounded-full overflow-hidden">
                    <MotiView 
                        from={{ translateX: -100 }}
                        animate={{ translateX: 100 }}
                        transition={{ loop: true, duration: 2000 }}
                        className="w-1/2 h-full bg-indigo-500"
                    />
                </View>
                <Text className="text-slate-500 text-[9px] mt-8 text-center uppercase font-bold tracking-widest px-10">
                    Running entirely on your device. No data leaves this app.
                </Text>
            </View>
        );
    }

    if (status === 'completed' && evaluationResult) {
        return (
            <View className="flex-1 bg-white">
                <ScrollView contentContainerStyle={{ paddingTop: insets.top + 40, paddingBottom: 100 }} className="p-8">
                    <View className={`w-24 h-24 rounded-[32px] items-center justify-center mb-8 self-center shadow-xl ${evaluationResult.passed ? 'bg-green-100' : 'bg-red-100'}`}>
                        <Ionicons name={evaluationResult.passed ? "trophy" : "alert-circle"} size={48} color={evaluationResult.passed ? "#16a34a" : "#dc2626"} />
                    </View>
                    
                    <Text className="text-slate-900 font-black text-4xl text-center mb-2">{evaluationResult.passed ? "Passed!" : "Review Required"}</Text>
                    <Text className="text-slate-400 text-center font-bold uppercase tracking-widest text-xs mb-10">Module Assessment Result</Text>
                    
                    <View className="bg-slate-50 p-8 rounded-[40px] border border-slate-100 shadow-sm mb-10">
                        <Text className="text-slate-800 text-lg leading-relaxed font-medium text-center italic">
                            "{evaluationResult.feedback}"
                        </Text>
                    </View>

                    {evaluationResult.passed ? (
                        <TouchableOpacity 
                            onPress={() => router.replace(`/modules/${id}`)}
                            className="bg-slate-900 py-6 rounded-3xl items-center shadow-2xl shadow-slate-200"
                        >
                            <Text className="text-white font-black text-xl">Finish & Earn Points</Text>
                        </TouchableOpacity>
                    ) : (
                        <View className="gap-4">
                            <TouchableOpacity 
                                onPress={() => { startGeneration(testType); }}
                                className="bg-slate-900 py-6 rounded-3xl items-center"
                            >
                                <Text className="text-white font-black text-xl">Retest me</Text>
                            </TouchableOpacity>
                            <TouchableOpacity 
                                onPress={() => router.back()}
                                className="bg-slate-100 py-6 rounded-3xl items-center"
                            >
                                <Text className="text-slate-600 font-black text-xl">Back to Content</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                </ScrollView>
            </View>
        );
    }

    return (
        <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
            {/* Header */}
            <View className="px-8 py-6 flex-row items-center justify-between border-b border-slate-50">
                <View>
                    <Text className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-1">Step {currentIndex + 1} of {questions.length}</Text>
                    <Text className="text-2xl font-black text-slate-900">Knowledge Check</Text>
                </View>
                <TouchableOpacity onPress={() => router.back()} className="w-12 h-12 rounded-2xl bg-slate-50 items-center justify-center">
                    <Ionicons name="close" size={24} color="#64748b" />
                </TouchableOpacity>
            </View>

            <ScrollView className="flex-1 p-8" showsVerticalScrollIndicator={false}>
                <AnimatePresence>
                    <MotiView
                        key={currentIndex}
                        from={{ opacity: 0, translateX: 20 }}
                        animate={{ opacity: 1, translateX: 0 }}
                        exit={{ opacity: 0, translateX: -20 }}
                        className="mb-10"
                    >
                        <View className="bg-indigo-600 self-start px-4 py-2 rounded-xl mb-6">
                            <Text className="text-white font-black text-[10px] uppercase tracking-wider">{currentQuestion?.type} Assessment</Text>
                        </View>
                        
                        <Text className="text-slate-900 font-black text-2xl leading-tight mb-10">
                            {currentQuestion?.text}
                        </Text>

                        {currentQuestion?.type === 'quiz' ? (
                            <View className="gap-4">
                                {currentQuestion.options?.map((option, idx) => (
                                    <TouchableOpacity 
                                        key={idx}
                                        onPress={() => handleAnswerChange(option)}
                                        className={`p-6 rounded-3xl border ${currentQuestion.answer === option ? 'bg-indigo-600 border-indigo-600' : 'bg-slate-50 border-slate-100'}`}
                                    >
                                        <Text className={`font-black text-base ${currentQuestion.answer === option ? 'text-white' : 'text-slate-800'}`}>
                                            {option}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        ) : (
                            <View>
                                <TextInput
                                    multiline
                                    placeholder="Tap here to write your answer..."
                                    className="bg-slate-50 p-8 rounded-[40px] border border-slate-100 text-lg text-slate-800 min-h-[200px]"
                                    textAlignVertical="top"
                                    value={currentQuestion.answer}
                                    onChangeText={handleAnswerChange}
                                />
                                <View className="flex-row items-center mt-6 px-4">
                                    <View className="w-1.5 h-1.5 rounded-full bg-indigo-500 mr-2" />
                                    <Text className="text-slate-400 font-medium text-xs">AI will evaluate the quality of your explanation.</Text>
                                </View>
                            </View>
                        )}
                    </MotiView>
                </AnimatePresence>
            </ScrollView>

            <View className="p-8" style={{ paddingBottom: insets.bottom + 20 }}>
                <TouchableOpacity 
                    onPress={nextQuestion}
                    disabled={!currentQuestion?.answer}
                    className={`py-6 rounded-3xl items-center shadow-xl ${!currentQuestion?.answer ? 'bg-slate-200' : 'bg-slate-900 shadow-slate-200'}`}
                >
                    <Text className="text-white font-black text-lg uppercase tracking-widest">
                        {currentIndex < questions.length - 1 ? 'Next Question' : 'Submit Assessment'}
                    </Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({});
