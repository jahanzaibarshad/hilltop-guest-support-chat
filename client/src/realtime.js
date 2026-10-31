import { io } from 'socket.io-client';
import { useEffect, useRef, useState } from 'react';

export function mergeMessages(previous, incoming) {
  const unique = new Map(previous.map((message) => [message._id, message]));
  for (const message of incoming) unique.set(message._id, message);
  return [...unique.values()].sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt) || a._id.localeCompare(b._id),
  );
}

export function useRealtime({
  userId,
  chatId,
  onMessage,
  onSync,
  onChat,
  onSessionExpired,
  onError,
  onInbox,
  onConnected,
}) {
  const callbacks = useRef({
    chatId,
    onMessage,
    onSync,
    onChat,
    onSessionExpired,
    onError,
    onInbox,
    onConnected,
  });
  const socketRef = useRef(null);
  const synchronizeRef = useRef(null);
  const [state, setState] = useState('offline');
  useEffect(() => {
    callbacks.current = {
      chatId,
      onMessage,
      onSync,
      onChat,
      onSessionExpired,
      onError,
      onInbox,
      onConnected,
    };
  });
  useEffect(() => {
    if (!userId) return;
    let active = true,
      generation = 0,
      reconnectTimer;
    const socket = io({
      autoConnect: false,
      withCredentials: true,
      transports: ['websocket', 'polling'],
      tryAllTransports: true,
      timeout: 10000,
    });
    socketRef.current = socket;
    const failSession = () => {
      if (active) callbacks.current.onSessionExpired();
    };
    function reconnectLater() {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        if (active && !socket.connected) socket.connect();
      }, 5000);
    }
    async function synchronize() {
      if (!active || !socket.connected) return;
      const version = ++generation;
      const target = callbacks.current.chatId;
      if (!target) {
        setState('live');
        return;
      }
      setState('syncing');
      try {
        const response = await new Promise((resolve, reject) =>
          socket
            .timeout(8000)
            .emit('joinChat', { chatId: target }, (error, result) =>
              error
                ? reject(
                    new Error(
                      'Live connection timed out. Use Refresh to recover your conversation.',
                    ),
                  )
                : resolve(result),
            ),
        );
        if (!active || version !== generation || callbacks.current.chatId !== target) return;
        if (!response?.ok) {
          if (response?.status === 401) return failSession();
          throw new Error(response?.message || 'Could not join this conversation.');
        }
        callbacks.current.onChat(response.chat);
        await callbacks.current.onSync(target);
        if (active && version === generation && socket.connected) setState('live');
      } catch (error) {
        if (active && version === generation) {
          setState('offline');
          callbacks.current.onError(error.message);
        }
      }
    }
    synchronizeRef.current = synchronize;
    socket.on('connect', () => {
      callbacks.current.onConnected?.();
      void synchronize();
    });
    socket.on('inboxChanged', () => {
      if (active) callbacks.current.onInbox?.();
    });
    socket.on('newMessage', (message) => {
      if (active) callbacks.current.onMessage(message);
    });
    socket.on('chatUpdated', (chat) => {
      if (active) callbacks.current.onChat(chat);
    });
    socket.on('sessionError', (error) => {
      if (error.status === 401) failSession();
      else if (active) {
        setState('offline');
        callbacks.current.onError(error.message);
      }
    });
    socket.on('disconnect', (reason) => {
      ++generation;
      if (active) {
        setState('reconnecting');
        if (reason === 'io server disconnect') reconnectLater();
      }
    });
    socket.on('connect_error', (error) => {
      if (error.data?.status === 401) failSession();
      else if (active) {
        setState('reconnecting');
        if (!socket.active) reconnectLater();
      }
    });
    setState('connecting');
    socket.connect();
    return () => {
      active = false;
      ++generation;
      clearTimeout(reconnectTimer);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      synchronizeRef.current = null;
    };
  }, [userId]);
  useEffect(() => {
    synchronizeRef.current?.();
    return () => {
      const socket = socketRef.current;
      if (chatId && socket?.connected) socket.emit('leaveChat', { chatId }, () => {});
    };
  }, [chatId, userId]);
  function sendMessage(input) {
    const socket = socketRef.current;
    if (!socket?.connected)
      return Promise.reject(
        new Error('Live chat disconnected. Retry to send through the REST fallback.'),
      );
    return new Promise((resolve, reject) => {
      socket.timeout(8000).emit('sendMessage', input, (error, response) => {
        if (error)
          return reject(
            new Error(
              'Delivery not confirmed. Check your conversation, or retry the same message.',
            ),
          );
        if (!response?.ok) {
          if (response?.status === 401) callbacks.current.onSessionExpired();
          return reject(new Error(response?.message || 'Message was not sent.'));
        }
        resolve(response.message);
      });
    });
  }
  return { state: userId ? state : 'offline', sendMessage };
}
