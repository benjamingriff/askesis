import {
  ArrowUp,
  Bot,
  MessageCircle,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { NavLink, useParams } from 'react-router';

type Message = { id: string; role: 'user' | 'assistant'; content: string };
type Conversation = { id: string; title: string; preview: string; messages: Message[] };

const conversations: Conversation[] = [
  {
    id: 'travel-week',
    title: 'Adjust next week around travel',
    preview: 'Move the quality session without losing the intent…',
    messages: [
      {
        id: '1',
        role: 'user',
        content: 'I am travelling Tuesday to Thursday next week. How should I adjust the plan?',
      },
      {
        id: '2',
        role: 'assistant',
        content:
          'I would move Wednesday’s quality session to Friday and keep Monday easy. Saturday’s long run can stay in place, provided Friday remains controlled. That preserves the key stimulus while giving you a recovery day after travelling.',
      },
    ],
  },
  {
    id: 'hill-session',
    title: 'Explain Wednesday’s hill session',
    preview: 'The uphill repetitions build force and running economy…',
    messages: [
      { id: '1', role: 'user', content: 'What is the purpose of Wednesday’s uphill repetitions?' },
      {
        id: '2',
        role: 'assistant',
        content:
          'The six short uphill repetitions develop running-specific strength and improve your mechanics without the sustained metabolic load of a hard interval session. Run tall and relaxed rather than sprinting.',
      },
    ],
  },
  {
    id: 'cardiff-goal',
    title: 'Review my Cardiff goal',
    preview: 'Your current calibration supports a progressive target…',
    messages: [
      {
        id: '1',
        role: 'user',
        content: 'Does the current plan look appropriate for my Cardiff goal?',
      },
      {
        id: '2',
        role: 'assistant',
        content:
          'The structure is sensible: frequency is stable, volume rises gradually, and the plan introduces quality without crowding the long run. I would reassess your target after the 10 km time trial.',
      },
    ],
  },
];

const suggestions = [
  'Explain my next workout',
  'Make next week easier',
  'Why is this session important?',
];

function getMockReply(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('next workout'))
    return 'Your next workout is an easy run with short strides. The easy running builds aerobic volume, while the strides keep some speed and coordination in your legs without adding meaningful fatigue.';
  if (lower.includes('easier') || lower.includes('tired'))
    return 'I would first reduce the duration of the easy runs and keep the key session intact. If fatigue is more than temporary, we could also shorten the long run and remove the strides.';
  if (lower.includes('move') || lower.includes('reschedule'))
    return 'That should be possible. I would check the sessions on either side before moving it so that hard efforts remain separated by enough recovery.';
  return 'For this prototype I am using a mock coaching response. Once the agent is connected, I will be able to inspect the complete plan, explain its intent, and suggest validated changes through the Askesis API.';
}

export function ChatPage() {
  const { conversationId } = useParams();
  return <ChatConversation key={conversationId ?? 'new'} conversationId={conversationId} />;
}

function ChatConversation({ conversationId }: { conversationId: string | undefined }) {
  const selected = conversations.find((conversation) => conversation.id === conversationId);
  const [messages, setMessages] = useState<Message[]>(selected?.messages ?? []);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  function sendMessage(event?: FormEvent, suggestedMessage?: string) {
    event?.preventDefault();
    const content = (suggestedMessage ?? draft).trim();
    if (content.length === 0 || thinking) return;

    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content };
    setMessages((current) => [...current, userMessage]);
    setDraft('');
    setThinking(true);
    window.setTimeout(() => {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: getMockReply(content),
        },
      ]);
      setThinking(false);
    }, 850);
  }

  return (
    <div className={`chat-layout${panelOpen ? '' : ' context-closed'}`}>
      <aside className="chat-context-panel">
        <div className="context-header">
          <div>
            <span className="assistant-icon">
              <Sparkles size={17} />
            </span>
            <strong>Askesis coach</strong>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={() => setPanelOpen(false)}
            aria-label="Hide conversations"
          >
            <PanelLeftClose size={18} />
          </button>
        </div>
        <NavLink className="new-chat-button" to="/chat">
          <Plus size={17} /> New conversation
        </NavLink>
        <label className="chat-search">
          <Search size={16} />
          <input type="search" placeholder="Search conversations" />
        </label>
        <div className="conversation-heading">Conversations</div>
        <nav className="conversation-list">
          {conversations.map((conversation) => (
            <NavLink to={`/chat/${conversation.id}`} key={conversation.id}>
              <MessageCircle size={17} />
              <span>
                <strong>{conversation.title}</strong>
                <small>{conversation.preview}</small>
              </span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <section className="chat-main">
        <header className="chat-topbar">
          {!panelOpen && (
            <button
              className="icon-button"
              type="button"
              onClick={() => setPanelOpen(true)}
              aria-label="Show conversations"
            >
              <PanelLeftOpen size={19} />
            </button>
          )}
          <strong>
            {selected?.title ?? (messages.length > 0 ? 'New conversation' : 'Askesis coach')}
          </strong>
          <button className="icon-button" type="button" aria-label="Conversation options">
            <MoreHorizontal size={19} />
          </button>
        </header>

        <div className={`message-scroll${messages.length === 0 ? ' empty' : ''}`}>
          {messages.length === 0 ? (
            <div className="chat-empty-state">
              <span className="empty-spark">
                <Sparkles size={24} />
              </span>
              <h1>How can I help with your training?</h1>
              <p>Ask about your plan, a workout, or how to adapt the week around your life.</p>
              <div className="suggestion-list">
                {suggestions.map((suggestion) => (
                  <button
                    type="button"
                    key={suggestion}
                    onClick={() => sendMessage(undefined, suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages">
              {messages.map((message) => (
                <article className={`message ${message.role}`} key={message.id}>
                  {message.role === 'assistant' && (
                    <span className="message-avatar">
                      <Bot size={17} />
                    </span>
                  )}
                  <div>
                    <span className="message-author">
                      {message.role === 'assistant' ? 'Askesis' : 'You'}
                    </span>
                    <p>{message.content}</p>
                  </div>
                </article>
              ))}
              {thinking && (
                <article className="message assistant">
                  <span className="message-avatar">
                    <Bot size={17} />
                  </span>
                  <div>
                    <span className="message-author">Askesis</span>
                    <div className="thinking-dots">
                      <i />
                      <i />
                      <i />
                    </div>
                  </div>
                </article>
              )}
              <div ref={endRef} />
            </div>
          )}
        </div>

        <div className="composer-wrap">
          <form className="chat-composer" onSubmit={(event) => sendMessage(event)}>
            <button type="button" aria-label="Attach a file" disabled>
              <Paperclip size={19} />
            </button>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask anything about your training"
              rows={1}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage();
                }
              }}
            />
            <button
              className="send-button"
              type="submit"
              disabled={draft.trim().length === 0 || thinking}
              aria-label="Send message"
            >
              <ArrowUp size={19} />
            </button>
          </form>
          <p>Askesis can make mistakes. Review changes before applying them to your plan.</p>
        </div>
      </section>
    </div>
  );
}
