import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { CustomToast } from '../components/CustomToast';
import { toastManager } from '../utils/toast';

export type ToastStatus = 'success' | 'error' | 'info' | 'warning';

interface ToastOptions {
    status?: ToastStatus;
    title?: string;
    duration?: number;
}

interface ToastContextValue {
    showToast: (message: string, options?: ToastOptions) => void;
    hideToast: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const useToast = () => {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToast must be used within ToastProvider');
    return ctx;
};

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
    const [visible, setVisible] = useState(false);
    const [message, setMessage] = useState('');
    const [status, setStatus] = useState<ToastStatus>('info');
    const [title, setTitle] = useState('Notification');
    const [duration, setDuration] = useState(3000);

    const showToast = useCallback((msg: string, options?: ToastOptions) => {
        setMessage(msg);
        setStatus(options?.status ?? 'info');
        setTitle(options?.title ?? (options?.status === 'error' ? 'Error' : 'Notification'));
        setDuration(options?.duration ?? 3000);
        setVisible(true);
        setTimeout(() => setVisible(false), options?.duration ?? 3000);
    }, []);

    const hideToast = useCallback(() => setVisible(false), []);

    useEffect(() => {
        const unsubscribe = toastManager.subscribe((msg, options) => {
            showToast(msg, options);
        });
        return () => { unsubscribe(); };
    }, [showToast]);

    return (
        <ToastContext.Provider value={{ showToast, hideToast }}>
            {children}
            {visible && (
                <CustomToast
                    id="global-toast"
                    status={status}
                    title={title}
                    description={message}
                    onClose={hideToast}
                />
            )}
        </ToastContext.Provider>
    );
};
