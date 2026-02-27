import { firestore } from './firebase';
import { collection, addDoc, serverTimestamp, doc, updateDoc, getDoc } from 'firebase/firestore';
import { TelemetryEvent } from '../types';

const TELEMETRY_COLLECTION = 'telemetry';
const APP_VERSION = '0.1.7';

type TelemetryExtras = {
    reconnectCount?: number;
    uptimeMs?: number;
    bindError?: string | null;
};

export const logStreamStart = async (uid: string, email: string, sessionId: string, destinations: string[], quality: string, extras: TelemetryExtras = {}) => {
    if (!firestore) return null;

    try {
        const event: TelemetryEvent = {
            uid,
            email,
            type: 'stream_start',
            timestamp: serverTimestamp(),
            sessionId,
            destinations,
            quality,
            reconnectCount: extras.reconnectCount,
            uptimeMs: extras.uptimeMs,
            bindError: extras.bindError ?? null,
            appVersion: APP_VERSION,
            platform: typeof window !== 'undefined' && !!(window as any).aetherDesktop ? 'desktop' : 'web'
        };

        const docRef = await addDoc(collection(firestore, TELEMETRY_COLLECTION), event);
        return docRef.id;
    } catch (err) {
        console.error("Failed to log stream start", err);
        return null;
    }
};

export const logStreamStop = async (logId: string, durationSeconds: number, extras: TelemetryExtras = {}) => {
    if (!firestore || !logId) return;

    try {
        const logRef = doc(firestore, TELEMETRY_COLLECTION, logId);
        await updateDoc(logRef, {
            type: 'stream_stop',
            duration: Math.floor(durationSeconds),
            reconnectCount: extras.reconnectCount,
            uptimeMs: extras.uptimeMs,
            bindError: extras.bindError ?? null,
            stoppedAt: serverTimestamp()
        });
    } catch (err) {
        console.error("Failed to log stream stop", err);
    }
};

export const logStreamError = async (uid: string, email: string, sessionId: string, error: string, extras: TelemetryExtras = {}) => {
    if (!firestore) return;

    try {
        const event: TelemetryEvent = {
            uid,
            email,
            type: 'stream_error',
            timestamp: serverTimestamp(),
            sessionId,
            error,
            reconnectCount: extras.reconnectCount,
            uptimeMs: extras.uptimeMs,
            bindError: extras.bindError ?? null,
            appVersion: APP_VERSION,
            platform: typeof window !== 'undefined' && !!(window as any).aetherDesktop ? 'desktop' : 'web'
        };
        await addDoc(collection(firestore, TELEMETRY_COLLECTION), event);
    } catch (err) {
        console.error("Failed to log stream error", err);
    }
};
