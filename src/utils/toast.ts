type ToastStatus = 'success' | 'error' | 'info' | 'warning';
interface ToastOptions {
    status?: ToastStatus;
    title?: string;
    duration?: number;
}

type ToastListener = (message: string, options?: ToastOptions) => void;

class ToastManager {
    private listeners: Set<ToastListener> = new Set();

    subscribe(listener: ToastListener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    show(message: string, options?: ToastOptions) {
        this.listeners.forEach(listener => listener(message, options));
    }
}

export const toastManager = new ToastManager();

export const showToast = (message: string, options?: ToastOptions) => {
    toastManager.show(message, options);
};
