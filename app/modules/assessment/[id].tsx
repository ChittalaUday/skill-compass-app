import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { AnimatePresence, MotiView } from 'moti';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { LFM2_5_350M, useLLM } from 'react-native-executorch';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from '../../../src/store';
import { completeModule, fetchMyLearningPath } from '../../../src/store/slices/learningSlice';

import { aiService } from '../../../src/services/aiService';

interface Question {
    id: string;
    type: 'quiz' | 'qa' | 'essay';
    text: string;
    options?: string[]; // For quiz
    answer: string; // User input
    correctAnswer?: string; // Pre-generated answer
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
    const [localLlmConfig, setLocalLlmConfig] = useState<any>(null);

    const llmConfig = React.useMemo(() => ({
        model: localLlmConfig || LFM2_5_350M,
        preventLoad: !localLlmConfig,
    }), [localLlmConfig]);

    const llm = useLLM(llmConfig);

    const startGeneration = async (type: typeof testType) => {
        setTestType(type);
        setStatus('generating');

        try {
            if (!llm.isReady) {
                setAiLog('Preparing AI System...');
                const config = await aiService.ensureModelDownloaded(LFM2_5_350M, (p, s) => {
                    setAiLog(`${s} (${Math.round(p * 100)}%)`);
                });
                setLocalLlmConfig(config);
                
                setAiLog('Warming up AI...');
                let retries = 0;
                while (!llm.isReady && retries < 30) {
                    await new Promise(r => setTimeout(r, 1000));
                    retries++;
                }
            }
            
            setAiLog('Analyzing module content to craft questions...');
            await new Promise(r => setTimeout(r, 800));

            const isQuiz = type === 'quiz';
            const isQA = type === 'qa';
            const isEssay = type === 'essay';

            const constraints = isQuiz ? 'EXACTLY 5 questions' : (isQA ? 'EXACTLY 2 concise questions' : 'EXACTLY 1 deep explanation prompt');
            
            const systemPrompt = `You are a professional Assessment Architect. Return ONLY raw JSON. 
- For 'quiz': 4 options, one correctAnswer.
- For 'qa' or 'essay': NO options, NO correctAnswer. These are open-ended.`;

            const prompt = `[CONTEXT] Title: ${module?.title}, Category: ${module?.category}, Content: ${module?.description}.
[CONSTRAINTS] Type: ${type}, Quantity: ${constraints}. 
[INSTRUCTION] Generate the questions. 
If 'quiz', return: {"type": "quiz", "text": "...", "options": ["...", "..."], "correctAnswer": "..."}.
If 'qa', return: {"type": "qa", "text": "..."}.
If 'essay', return: {"type": "essay", "text": "..."}.
Return ONE SINGLE JSON array.`;
            
            // Heavy CPU Task
            const response = await llm.generate([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt }
            ]);
            console.log("AI Response:", response);

            let jsonString = response.trim();
            
            // Extraction: Find the start of the first array and the end of the last array
            const first = jsonString.indexOf('[');
            const last = jsonString.lastIndexOf(']');
            if (first !== -1 && last !== -1) {
                jsonString = jsonString.substring(first, last + 1);
            }

            // Cleanup potential AI errors like multiple top-level arrays which are invalid
            if (jsonString.includes('][')) {
                jsonString = jsonString.replace(/\]\s*\[/g, ',');
            }

            let parsed = JSON.parse(jsonString);
            
            // Handle if the AI wrapped the result in an extra array [[...]]
            if (Array.isArray(parsed) && parsed.length > 0 && Array.isArray(parsed[0])) {
                parsed = parsed[0];
            } else if (!Array.isArray(parsed) && parsed && typeof parsed === 'object') {
                // Handle if it returned a single object: { "text": "..." } or { "essay": "..." }
                parsed = [parsed];
            } else if (!Array.isArray(parsed)) {
                parsed = [];
            }
            
            // Normalize and ensure at least 5 questions for quiz if possible
            const formatted = parsed
                .filter((q: any) => q && typeof q === 'object')
                .map((q: any, i: number) => {
                    // Shim for inconsistent AI property names
                    const text = q.text || q.question || q.essay || q.prompt;
                    if (!text) return null;
                    
                    return {
                        ...q,
                        text,
                        id: `q-${i}`,
                        answer: ''
                    };
                })
                .filter(Boolean)
                .slice(0, 15);
            
            if (formatted.length === 0) {
                throw new Error("No valid questions found in AI response");
            }
            
            setQuestions(formatted);
            setCurrentIndex(0); // Reset index for new generation
            setStatus('answering');
        } catch (error) {
            console.error('Generation error:', error);
            Alert.alert('AI Data Error', 'The local AI provided an unstructured response. Please try choosing a different format or try again.');
            setStatus('choosing');
        }
    };

    const currentQuestion = questions[currentIndex];

    const handleAnswerChange = (text: string) => {
        if (!currentQuestion) return;
        setQuestions(prev => {
            const updated = [...prev];
            updated[currentIndex] = { ...updated[currentIndex], answer: text };
            return updated;
        });
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

        if (testType === 'quiz') {
            setAiLog('Checking your quiz answers...');
            await new Promise(r => setTimeout(r, 1000));

            // Normalize strings for comparison to avoid whitespace/casing mismatches
            const incorrectOnes = questions.filter(q => {
                const u = (q.answer || "").trim().toLowerCase();
                const c = (q.correctAnswer || "").trim().toLowerCase();
                return u !== c;
            });

            const passed = incorrectOnes.length === 0;
            const score = Math.round(((questions.length - incorrectOnes.length) / questions.length) * 100);

            const result = {
                passed,
                score,
                feedback: passed
                    ? "Perfect score! You've mastered this lesson."
                    : `You missed ${incorrectOnes.length} question(s). A 100% score is required to pass.`
            };

            setEvaluationResult(result);
            if (passed) {
                await dispatch(completeModule({
                    moduleId: id as string,
                    testResults: {
                        score: result.score,
                        questions: questions.map(q => ({ q: q.text, a: q.answer })),
                        feedback: result.feedback
                    }
                })).unwrap();
                await dispatch(fetchMyLearningPath());
            }
            setStatus('completed');
            return;
        }

        // For QA or Essay
        setAiLog('Local AI is reviewing your responses...');
        await new Promise(r => setTimeout(r, 800));

        // CRITICAL: Hard check for minimum effort (total length of all answers)
        const allAnswersStr = questions.map(q => q.answer || "").join(" ");
        const totalAnswerLength = allAnswersStr.length;
        const words = allAnswersStr.toLowerCase().split(/\s+/).filter(w => w.length > 0);
        const uniqueWords = new Set(words);
        
        // Automatic fail if too short or repetitive (gibberish/spam)
        if (totalAnswerLength < 50 || (words.length > 5 && uniqueWords.size / words.length < 0.4)) {
            setEvaluationResult({
                passed: false,
                feedback: "Your responses are too brief (minimum 50 characters required) or repetitive. Please provide a clear, original explanation to pass.",
                score: 0
            });
            setStatus('completed');
            return;
        }

        try {
            const context = questions.map((q, i) => `[Question ${i + 1}] ${q.text}\n[User Answer] ${q.answer}`).join('\n\n');
            const systemPrompt = "You are a highly Critical and Skeptical Subject Matter Expert. You must verify that the user actually learned the material. Return ONLY raw JSON.";
            const evalPrompt = `[MODULE] ${module?.title}\n[USER RESPONSES]\n${context}\n\n[GRADING RULES]\n1. Be skeptical. If answers are lazy, irrelevant, gibberish, or factually wrong, set passed: false.\n2. If the user repeats the question or gives nonsensical filler, set passed: false.\n3. Only set passed: true if the user demonstrates real conceptual understanding of ${module?.title}.\n4. Return ONLY: {"passed": boolean, "feedback": "Why did they pass/fail?", "score": number}.\n\n[RESULT]`;

            const response = await llm.generate([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: evalPrompt }
            ]);

            console.log('Evaluation response:', response);

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
                await dispatch(fetchMyLearningPath());
            }
            setStatus('completed');
        } catch (error) {
            console.error('Evaluation error:', error);
            setStatus('answering');
            Alert.alert('Analysis Failed', 'There was a problem. Please try again.');
        }
    };

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

    if (status === 'generating') {
        return (
            <View className="flex-1 bg-white justify-center items-center p-10">
                <TouchableOpacity
                    onPress={() => setStatus('choosing')}
                    className="absolute top-12 right-12 w-12 h-12 rounded-full bg-slate-50 items-center justify-center border border-slate-200"
                >
                    <Ionicons name="close" size={24} color="#64748b" />
                </TouchableOpacity>

                <View className="items-center justify-center mb-10">
                    <MotiView
                        from={{ scale: 0.9, opacity: 0.5 }}
                        animate={{ scale: 1.1, opacity: 1 }}
                        transition={{ loop: true, type: 'timing', duration: 2000 }}
                        className="w-40 h-40 rounded-full border-2 border-indigo-100 items-center justify-center"
                    >
                        <Ionicons name="hardware-chip" size={48} color="#6366f1" />
                    </MotiView>
                </View>

                <Text className="text-slate-900 font-black text-2xl text-center mb-2 tracking-tight">AI Thinking...</Text>
                <Text className="text-indigo-600 font-medium text-center uppercase tracking-[2px] text-[10px]">{aiLog}</Text>

                <View className="mt-12">
                    <ActivityIndicator size="small" color="#6366f1" />
                </View>

                <Text className="text-slate-400 text-[9px] mt-12 text-center uppercase font-bold tracking-widest px-10">
                    Crafting your custom assessment...
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

            <ScrollView className="flex-1 p-8" showsVerticalScrollIndicator={false} pointerEvents={status === 'evaluating' ? 'none' : 'auto'}>
                <AnimatePresence exitBeforeEnter>
                    <MotiView
                        key={currentIndex}
                        from={{ opacity: 0, translateY: 10 }}
                        animate={{ opacity: 1, translateY: 0 }}
                        exit={{ opacity: 0, translateY: -10 }}
                        transition={{ type: 'timing', duration: 400 }}
                        className="mb-10"
                    >
                        <View className="bg-indigo-600 self-start px-4 py-2 rounded-xl mb-6">
                            <Text className="text-white font-black text-[10px] uppercase tracking-wider">{currentQuestion?.type} Assessment</Text>
                        </View>
                        
                        <MotiView
                            from={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 200 }}
                        >
                            <Text className="text-slate-900 font-black text-2xl leading-tight mb-10">
                                {currentQuestion?.text}
                            </Text>
                        </MotiView>

                        {currentQuestion?.type === 'quiz' ? (
                            <View className="gap-4">
                                {currentQuestion.options?.map((option, idx) => (
                                    <MotiView
                                        key={idx}
                                        from={{ opacity: 0, scale: 0.9 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        transition={{ delay: 300 + idx * 50 }}
                                    >
                                        <TouchableOpacity 
                                            onPress={() => handleAnswerChange(option)}
                                            disabled={status === 'evaluating'}
                                            className={`p-6 rounded-3xl border ${currentQuestion.answer === option ? 'bg-indigo-600 border-indigo-600' : 'bg-slate-50 border-slate-100'} ${status === 'evaluating' ? 'opacity-50' : ''}`}
                                        >
                                            <Text className={`font-black text-base ${currentQuestion.answer === option ? 'text-white' : 'text-slate-800'}`}>
                                                {option}
                                            </Text>
                                        </TouchableOpacity>
                                    </MotiView>
                                ))}
                            </View>
                        ) : (
                            <MotiView
                                from={{ opacity: 0, translateY: 20 }}
                                animate={{ opacity: 1, translateY: 0 }}
                                transition={{ delay: 300 }}
                            >
                                <TextInput
                                    multiline
                                    placeholder="Tap here to write your answer..."
                                    className="bg-slate-50 p-8 rounded-[40px] border border-slate-100 text-lg text-slate-800 min-h-[200px]"
                                    textAlignVertical="top"
                                    value={currentQuestion.answer}
                                    onChangeText={handleAnswerChange}
                                    editable={status !== 'evaluating'}
                                />
                                <View className="flex-row items-center mt-6 px-4">
                                    <View className="w-1.5 h-1.5 rounded-full bg-indigo-500 mr-2" />
                                    <Text className="text-slate-400 font-medium text-xs">AI will evaluate the quality of your explanation.</Text>
                                </View>
                            </MotiView>
                        )}
                    </MotiView>
                </AnimatePresence>
            </ScrollView>

            <View className="p-8" style={{ paddingBottom: insets.bottom + 20 }}>
                {status === 'evaluating' ? (
                    <View className="py-6 rounded-3xl items-center bg-indigo-50 flex-row justify-center gap-3 border border-indigo-100">
                        <ActivityIndicator size="small" color="#6366f1" />
                        <Text className="text-indigo-600 font-black text-lg uppercase tracking-widest">Evaluating...</Text>
                    </View>
                ) : (
                    <TouchableOpacity
                        onPress={nextQuestion}
                        disabled={!currentQuestion?.answer}
                        className={`py-6 rounded-3xl items-center shadow-xl ${!currentQuestion?.answer ? 'bg-slate-200' : 'bg-slate-900 shadow-slate-200'}`}
                    >
                        <Text className="text-white font-black text-lg uppercase tracking-widest">
                            {currentIndex < questions.length - 1 ? 'Next Question' : 'Submit Assessment'}
                        </Text>
                    </TouchableOpacity>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({});
