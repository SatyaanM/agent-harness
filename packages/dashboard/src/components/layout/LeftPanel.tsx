interface LeftPanelProps {
  children: React.ReactNode;
}

export default function LeftPanel({ children }: LeftPanelProps) {
  return (
    <div className="h-full overflow-y-auto bg-white dark:bg-zinc-950">
      {children}
    </div>
  );
}
