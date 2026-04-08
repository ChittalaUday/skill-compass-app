import Constants from 'expo-constants';
import React, { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { io, Socket } from 'socket.io-client';
import { RootState } from '../store';
import { useToast } from './ToastContext';

interface SocketContextType {
    socket: Socket | null;
    isConnected: boolean;
}

const SocketContext = createContext<SocketContextType>({
    socket: null,
    isConnected: false,
});

export const useSocket = () => useContext(SocketContext);

interface SocketProviderProps {
    children: ReactNode;
}

// Get Socket URL from runtime config
const getSocketUrl = () => {
  const extra = Constants.expoConfig?.extra || {};
  return (
    extra.EXPO_PUBLIC_SOCKET_URL || 
    process.env.EXPO_PUBLIC_SOCKET_URL || 
    'http://51.20.182.252:5003'
  );
};

const SOCKET_URL = getSocketUrl();

console.log('[Socket] Using SOCKET_URL:', SOCKET_URL);

export const SocketProvider: React.FC<SocketProviderProps> = ({ children }) => {
    const [socket, setSocket] = useState<Socket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const { token } = useSelector((state: RootState) => state.auth);
    const { showToast } = useToast();

    useEffect(() => {
        if (!token) {
            if (socket) {
                socket.disconnect();
                setSocket(null);
                setIsConnected(false);
            }
            return;
        }

        const newSocket = io(SOCKET_URL, {
            transports: ['websocket'],
            auth: {
                token: `Bearer ${token}`,
            },
        });

        newSocket.on('connect', () => {
            console.log('🌐 Global Socket Connected');
            setIsConnected(true);
        });

        newSocket.on('disconnect', () => {
            console.log('🌐 Global Socket Disconnected');
            setIsConnected(false);
        });

        newSocket.on('notification', (data: any) => {
            console.log('🔔 Notification Received:', data);
            if (data?.message) {
                showToast(data.message, { status: data.type || 'info', title: data.title || 'Notification' });
            }
        });

        setSocket(newSocket);

        return () => {
            newSocket.disconnect();
        };
    }, [token]);

    return (
        <SocketContext.Provider value={{ socket, isConnected }}>
            {children}
        </SocketContext.Provider>
    );
};
