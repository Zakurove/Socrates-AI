import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface Turn {
  role: "user" | "ai";
  text: string;
}

interface ConversationAreaProps {
  turns: Turn[];
  currentAIText?: string;
  isAISpeaking?: boolean;
  mode: "narration" | "conversation";
  className?: string;
}

export function ConversationArea({
  turns,
  currentAIText,
  isAISpeaking,
  mode,
  className,
}: ConversationAreaProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, currentAIText]);

  const isEmpty = turns.length === 0 && !currentAIText;

  if (isEmpty) {
    return (
      <div className={cn("flex-1 flex items-center justify-center px-6", className)}>
        <p className="text-muted-foreground text-sm">Start speaking...</p>
      </div>
    );
  }

  if (mode === "narration") {
    return (
      <div className={cn("flex-1 overflow-y-auto px-4 py-4 space-y-3", className)}>
        <p className="text-xs text-muted-foreground">Live transcription</p>
        {turns.map((turn, i) => (
          <p key={i} className="text-sm text-foreground leading-relaxed">
            {turn.text}
          </p>
        ))}
        {currentAIText && isAISpeaking && (
          <p className="text-sm text-foreground leading-relaxed">
            {currentAIText}
            <span className="inline-block w-1.5 h-4 bg-brand-accent rounded-sm ml-0.5 animate-pulse" />
          </p>
        )}
        <div ref={bottomRef} />
      </div>
    );
  }

  // Conversation mode
  return (
    <div className={cn("flex-1 overflow-y-auto px-4 py-4 space-y-3", className)}>
      <p className="text-xs text-muted-foreground">Patient conversation</p>
      {turns.map((turn, i) => (
        <div
          key={i}
          className={cn(
            "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            turn.role === "user"
              ? "self-end bg-primary/10 text-foreground rounded-br-md ml-auto"
              : "self-start bg-muted text-foreground rounded-bl-md"
          )}
        >
          {turn.text}
        </div>
      ))}
      {currentAIText && isAISpeaking && (
        <div className="max-w-[85%] self-start bg-muted text-foreground rounded-2xl rounded-bl-md px-4 py-2.5 text-sm leading-relaxed">
          {currentAIText}
          <span className="inline-block w-1.5 h-4 bg-brand-accent rounded-sm ml-0.5 animate-pulse" />
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
