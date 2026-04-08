import React, { useState, useEffect, useRef } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { MotiView } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLLM, LFM2_5_350M } from 'react-native-executorch';
import { aiService } from '../services/aiService';

interface ModuleAssessmentModalProps {
    visible: boolean;
    onClose: () => void;
    module: any;
    onComplete: () => Promise<void>;
}

type TestType = 'quiz' | 'qa' | 'essay';
type Step = 'choose' | 'preparing' | 'answering' | 'evaluating' | 'result';

export const ModuleAssessmentModal = ({ visible, onClose, module, onComplete }: ModuleAssessmentModalProps) => {
    const insets = useSafeAreaInsets();
    const [step, setStep] = useState<Step>('choose');
    const [testType, setTestType] = useState<TestType>('quiz');
    const [question, setQuestion] = useState('');
    const [answer, setAnswer] = useState('');
    const [feedback, setFeedback] = useState('');
    const [isPassed, setIsPassed] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // LLM for local assessment
    const llm = useLLM({
        model: LFM2_5_350M,
    });

    const startTest = async (type: TestType) => {
        setTestType(type);
        setStep('preparing');
        
        try {
            if (!llm.isReady) {
                // Wait for model if not ready
                let retries = 0;
                while (!llm.isReady && retries < 15) {
                    await new Promise(r => setTimeout(r, 1000));
                    retries++;
                }
            }

            const prompt = `[CONTEXT] Module: ${module.title}. Description: ${module.description}. Skills: ${module.skillTags?.join(', ')}. [INSTRUCTION] Generate ONE ${type === 'quiz' ? 'Multiple Choice Question (4 options)' : (type === 'qa' ? 'short practical question' : 'essay prompt')} to test understanding of this module. Return ONLY the question/prompt text.`;
            
            const response = await llm.generate([{ role: 'user', content: prompt }]);
            setQuestion(response);
            setStep('answering');
        } catch (error) {
            console.error('Test generation error:', error);
            Alert.alert('Error', 'Failed to generate assessment. Please try again.');
            setStep('choose');
        }
    };

    const submitAnswer = async () => {
        if (!answer.trim()) return;
        setIsSubmitting(true);
        setStep('evaluating');

        try {
            const evaluationPrompt = `[CONTEXT] Module: ${module.title}. Question: ${question}. User Answer: ${answer}. [INSTRUCTION] Grade this answer. Return a JSON object with "passed" (boolean) and "feedback" (string summary). Format: {"passed": true/false, "feedback": "..."}`;
            
            const resultStr = await llm.generate([{ role: 'user', content: evaluationPrompt }]);
            let result;
            try {
                // Clean markdown if present
                const cleanJson = resultStr.replace(/```json/g, '').replace(/```/g, '').trim();
                result = JSON.parse(cleanJson);
            } catch (e) {
                // Fallback heuristic if LLM fails JSON
                result = { 
                    passed: resultStr.toLowerCase().includes('pass') || resultStr.toLowerCase().includes('correct'),
                    feedback: resultStr 
                };
            }

            setIsPassed(result.passed);
            setFeedback(result.feedback);
            setStep('result');

            if (result.passed) {
                await onComplete();
            }
        } catch (error) {
            Alert.alert('Error', 'Evaluation failed. Let\'s try again.');
            setStep('answering');
        } finally {
            setIsSubmitting(false);
        }
    };

    const reset = () => {
        setStep('choose');
        setAnswer('');
        setQuestion('');
        setFeedback('');
    };

    if (!visible) return null;

    return (
        <Modal transparent visible={visible} animationType="fade">
            <BlurView intensity={90} tint="dark" style={StyleSheet.absoluteFill}>
                <View className="flex-1 justify-center p-6" style={{ paddingTop: insets.top }}>
                    <MotiView
                        from={{ opacity: 0, scale: 0.9, translateY: 20 }}
                        animate={{ opacity: 1, scale: 1, translateY: 0 }}
                        className="bg-white rounded-[40px] p-8 shadow-2xl overflow-hidden"
                    >
                        {/* Header */}
                        <View className="flex-row items-center justify-between mb-8">
                            <View>
                                <Text className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-1">Knowledge Check</Text>
                                <Text className="text-2xl font-black text-slate-900">Module Assessment</Text>
                            </View>
                            {step !== 'preparing' && step !== 'evaluating' && (
                                <TouchableOpacity onPress={onClose} className="w-10 h-10 rounded-full bg-slate-100 items-center justify-center">
                                    <Ionicons name="close" size={24} color="#64748B" />
                                </TouchableOpacity>
                            )}
                        </View>

                        <ScrollView showsVerticalScrollIndicator={false}>
                            {step === 'choose' && (
                                <View>
                                    <Text className="text-slate-500 font-medium mb-8 leading-relaxed">
                                        You've completed the learning part! To earn your completion badge, please select how you'd like to be assessed.
                                    </Text>
                                    
                                    {[
                                        { id: 'quiz', title: 'Multiple Choice Quiz', icon: 'list', desc: 'Fast and direct knowledge check' },
                                        { id: 'qa', title: 'Question & Answer', icon: 'chatbubbles', desc: 'Short answer practical test' },
                                        { id: 'essay', title: 'Creative Essay', icon: 'document-text', desc: 'Deep-dive explanation on a topic' }
                                    ].map((type) => (
                                        <TouchableOpacity 
                                            key={type.id}
                                            onPress={() => startTest(type.id as TestType)}
                                            className="bg-slate-50 p-6 rounded-3xl border border-slate-100 mb-4 flex-row items-center"
                                        >
                                            <View className="w-14 h-14 bg-white rounded-2xl items-center justify-center shadow-sm mr-4">
                                                <Ionicons name={type.icon as any} size={28} color="#4F46E5" />
                                            </View>
                                            <View className="flex-1">
                                                <Text className="text-slate-900 font-black text-base">{type.title}</Text>
                                                <Text className="text-slate-400 text-xs font-medium">{type.desc}</Text>
                                            </View>
                                            <MaterialIcons name="chevron-right" size={24} color="#CBD5E1" />
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            )}

                            {step === 'preparing' && (
                                <View className="py-12 items-center">
                                    <ActivityIndicator size="large" color="#4F46E5" />
                                    <Text className="text-slate-900 font-black text-xl mt-6">Generating Test...</Text>
                                    <Text className="text-slate-400 text-sm mt-2 text-center">Local AI is crafting a unique assessment for you</Text>
                                </View>
                            )}

                            {step === 'answering' && (
                                <View>
                                    <View className="bg-indigo-50 p-6 rounded-3xl mb-8 border border-indigo-100">
                                        <Text className="text-indigo-900 font-black text-lg leading-relaxed">
                                            {question}
                                        </Text>
                                    </View>
                                    
                                    <Text className="text-slate-900 font-black text-sm uppercase tracking-widest mb-3 px-1">Your Response</Text>
                                    <TextInput
                                        multiline
                                        placeholder="Type your answer here..."
                                        className="bg-slate-50 p-6 rounded-3xl border border-slate-200 text-base min-h-[150px] text-slate-800"
                                        textAlignVertical="top"
                                        value={answer}
                                        onChangeText={setAnswer}
                                    />
                                    
                                    <TouchableOpacity 
                                        onPress={submitAnswer}
                                        className="bg-slate-900 py-6 rounded-2xl items-center mt-8 shadow-lg shadow-slate-200"
                                    >
                                        <Text className="text-white font-black text-lg">Submit Assessment</Text>
                                    </TouchableOpacity>
                                </View>
                            )}

                            {step === 'evaluating' && (
                                <View className="py-12 items-center">
                                    <ActivityIndicator size="large" color="#4F46E5" />
                                    <Text className="text-slate-900 font-black text-xl mt-6">Grading Answer...</Text>
                                    <Text className="text-slate-400 text-sm mt-2">Our local AI is evaluating your response</Text>
                                </View>
                            )}

                            {step === 'result' && (
                                <View className="items-center py-6">
                                    <View className={`w-24 h-24 rounded-full items-center justify-center mb-6 shadow-xl ${isPassed ? 'bg-green-100 shadow-green-100' : 'bg-red-100 shadow-red-100'}`}>
                                        <Ionicons name={isPassed ? 'checkmark-circle' : 'close-circle'} size={64} color={isPassed ? '#16A34A' : '#DC2626'} />
                                    </View>
                                    
                                    <Text className="text-slate-900 font-black text-2xl mb-2">
                                        {isPassed ? 'Assessment Passed!' : 'Requires Review'}
                                    </Text>
                                    
                                    <View className="bg-slate-50 p-6 rounded-3xl w-full border border-slate-100 mb-8">
                                        <Text className="text-slate-600 text-center font-medium leading-relaxed italic">
                                            "{feedback}"
                                        </Text>
                                    </View>

                                    {isPassed ? (
                                        <TouchableOpacity 
                                            onPress={onClose}
                                            className="bg-indigo-600 w-full py-6 rounded-2xl items-center shadow-lg shadow-indigo-200"
                                        >
                                            <Text className="text-white font-black text-lg">Continue to Next Lesson</Text>
                                        </TouchableOpacity>
                                    ) : (
                                        <View className="w-full gap-3">
                                            <TouchableOpacity 
                                                onPress={reset}
                                                className="bg-slate-900 w-full py-6 rounded-2xl items-center shadow-lg"
                                            >
                                                <Text className="text-white font-black text-lg">Retest Now</Text>
                                            </TouchableOpacity>
                                            <TouchableOpacity 
                                                onPress={onClose}
                                                className="bg-slate-100 w-full py-6 rounded-2xl items-center"
                                            >
                                                <Text className="text-slate-600 font-black text-lg">Back to Module</Text>
                                            </TouchableOpacity>
                                        </View>
                                    )}
                                </View>
                            )}
                        </ScrollView>
                    </MotiView>
                </View>
            </BlurView>
        </Modal>
    );
};
