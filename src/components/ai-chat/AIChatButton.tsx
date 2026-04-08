import { MaterialIcons } from '@expo/vector-icons';
import { MotiView } from 'moti';
import React, { useState } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { AIChatModal } from './AIChatModal';

interface AIChatButtonProps {
    mode?: 'adult' | 'kid';
    position?: {
        bottom?: number;
        right?: number;
    };
    context?: string;
}

export const AIChatButton = ({ mode = 'adult', position = { bottom: 20, right: 20 }, context }: AIChatButtonProps) => {
    const [isModalVisible, setIsModalVisible] = useState(false);

    return (
        <View style={{
            position: 'absolute',
            bottom: position.bottom,
            right: position.right,
            zIndex: 40, // Below modal but above content
        }}>
            <MotiView
                from={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', delay: 1000 }}
            >
                <TouchableOpacity
                    onPress={() => setIsModalVisible(true)}
                    activeOpacity={0.8}
                    className={`w-16 h-16 rounded-full items-center justify-center shadow-lg ${mode === 'kid' ? 'bg-blue-500 border-4 border-white' : 'bg-indigo-600'
                        }`}
                    style={{
                        shadowColor: mode === 'kid' ? '#3b82f6' : '#4f46e5',
                        shadowOffset: { width: 0, height: 4 },
                        shadowOpacity: 0.3,
                        shadowRadius: 4,
                        elevation: 8,
                    }}
                >
                    <MaterialIcons
                        name={mode === 'kid' ? "smart-toy" : "chat-bubble"}
                        size={32}
                        color="white"
                    />
                    {mode === 'kid' && (
                        <View className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-white" />
                    )}
                </TouchableOpacity>
            </MotiView>

            <AIChatModal
                visible={isModalVisible}
                onClose={() => setIsModalVisible(false)}
                mode={mode}
                context={context}
            />
        </View>
    );
};
