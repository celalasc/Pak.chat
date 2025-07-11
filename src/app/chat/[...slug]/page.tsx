'use client';

import { useRouter } from 'next/navigation';
import { use, useEffect, useMemo, useState, useRef, memo } from 'react';
import { useQuery, useConvexAuth } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id, Doc } from '@/convex/_generated/dataModel';
import { isConvexId } from '@/lib/ids';
import Chat from '@/frontend/components/Chat';
import ErrorBoundary from '@/frontend/components/ErrorBoundary';
import { useIsMobile } from '@/frontend/hooks/useIsMobile';
import { saveLastChatId, saveLastPath } from '@/frontend/lib/lastChat';
import type { UIMessage } from 'ai';

const CatchAllChatPageInner = memo(function CatchAllChatPageInner({ params }: { params: Promise<{ slug: string[] }> }) {
  const resolvedParams = use(params);
  const chatId = resolvedParams.slug?.[0];
  
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const { isMobile, mounted } = useIsMobile();
  const wasMobileRef = useRef(isMobile);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  const isValidId = useMemo(() => isConvexId(chatId), [chatId]);

  const thread = useQuery(
    api.threads.get,
    isValidId ? { threadId: chatId as Id<'threads'> } : 'skip'
  );

  // Выполняем остальные запросы только если thread существует и доступен
  const shouldRunQueries = isValidId && thread !== null && thread !== undefined;

  const messagesResult = useQuery(
    api.messages.get,
    shouldRunQueries ? { threadId: chatId as Id<'threads'> } : 'skip'
  );

  const attachments = useQuery(
    api.attachments.byThread,
    shouldRunQueries ? { threadId: chatId as Id<'threads'> } : 'skip'
  );

  const lastMessagesRef = useRef<UIMessage[]>([]);
  const savedLastChatRef = useRef<{ id?: string, path?: string }>({});

  const messages = useMemo(() => {
    if (!attachments || !messagesResult) return lastMessagesRef.current;

    const attachmentsMap: Record<
      string,
      {
        id: Id<'attachments'>;
        messageId: Id<'messages'> | undefined;
        name: string;
        type: string;
        url: string | null;
      }[]
    > = {};

    attachments.forEach((a) => {
      if (!a.messageId) return;
      if (!attachmentsMap[a.messageId]) {
        attachmentsMap[a.messageId] = [];
      }
      attachmentsMap[a.messageId].push(a);
    });

    // Handle case where the query might still be loading.
    const rawMessages: Doc<'messages'>[] = messagesResult ?? []

    const formatted = rawMessages.map(m => ({
      id: m._id,
      role: m.role,
      content: m.content,
      createdAt: new Date(m._creationTime),
      parts: [{ type: 'text' as const, text: m.content }],
      attachments: attachmentsMap[m._id] ?? [],
      model: m.model,
    }))

    lastMessagesRef.current = formatted
    return formatted
  }, [messagesResult, attachments]);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      router.replace('/');
      return;
    }
    if (!isValidId) {
      router.replace('/chat');
      return;
    }
    if (thread === null) {
      router.replace('/chat');
      return;
    }
    
    // Если чат успешно загружен, сохраняем его как последний
    if (thread && isValidId) {
      if (savedLastChatRef.current.id !== chatId) {
        saveLastChatId(chatId);
        savedLastChatRef.current.id = chatId;
      }
      const path = `/chat/${chatId}`;
      if (savedLastChatRef.current.path !== path) {
        saveLastPath(path);
        savedLastChatRef.current.path = path;
      }
    }
  }, [authLoading, isAuthenticated, isValidId, router, chatId, thread]);

  // Автоматическое перенаправление при изменении типа устройства
  useEffect(() => {
    if (!mounted || !isAuthenticated || !isValidId || !thread) return;

    // Перенаправляем на мобильную версию только, если ранее сайт был открыт на десктопе
    if (isMobile && !wasMobileRef.current) {
      if (savedLastChatRef.current.id !== chatId) {
        saveLastChatId(chatId);
        savedLastChatRef.current.id = chatId;
      }
      const path = `/chat/${chatId}`;
      if (savedLastChatRef.current.path !== path) {
        saveLastPath(path);
        savedLastChatRef.current.path = path;
      }
      router.replace('/home');
    }

    wasMobileRef.current = isMobile;
  }, [isMobile, mounted, isAuthenticated, isValidId, thread, chatId, router]);

  const isLoading =
    authLoading ||
    !isValidId ||
    thread === undefined ||
    messagesResult === undefined ||
    attachments === undefined;

  useEffect(() => {
    if (!isLoading) {
      setIsInitialLoad(false);
      // Скрываем глобальный лоадер когда страница готова
      if (typeof window !== 'undefined' && window.__hideGlobalLoader) {
        window.__hideGlobalLoader();
      }
    }
  }, [isLoading]);

  if (isInitialLoad) {
    return <div className="w-full h-screen bg-background" />;
  }

  if (thread === null) {
    // Thread не найден или нет доступа - показываем заглушку, перенаправление в useEffect
    return <div className="w-full h-screen bg-background" />;
  }

  return (
    <Chat
      key={chatId}
      threadId={chatId}
      thread={thread}
      initialMessages={messages}
    />
  )
});

export default function CatchAllChatPage({ params }: { params: Promise<{ slug: string[] }> }) {
  return (
    <ErrorBoundary fallbackRedirect="/chat">
      <CatchAllChatPageInner params={params} />
    </ErrorBoundary>
  );
}