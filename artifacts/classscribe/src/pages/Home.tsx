import { Link } from "wouter";
import { BookOpen, BrainCircuit, Mic, FileText, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="min-h-dvh bg-background flex flex-col font-sans pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <header className="px-4 sm:px-6 py-4 flex items-center justify-between gap-2 max-w-7xl w-full mx-auto">
        <div className="flex items-center gap-2 text-primary shrink-0">
          <BookOpen className="w-6 h-6 sm:w-7 sm:h-7 shrink-0" />
          <span className="font-serif text-xl sm:text-2xl font-bold tracking-tight">ClassScribe</span>
        </div>
        <nav className="flex items-center gap-1 sm:gap-4 shrink-0">
          <Link href="/sign-in">
            <Button variant="ghost" className="font-medium px-2 sm:px-4">Sign In</Button>
          </Link>
          <Link href="/sign-up">
            <Button className="font-medium bg-primary text-primary-foreground px-3 sm:px-4">
              <span className="sm:hidden">Join</span>
              <span className="hidden sm:inline">Get Started</span>
            </Button>
          </Link>
        </nav>
      </header>

      <main className="flex-1">
        <section className="px-6 py-24 md:py-32 max-w-7xl mx-auto flex flex-col items-center text-center">
          <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-secondary/10 text-secondary mb-8">
            <BrainCircuit className="w-4 h-4 mr-2" />
            Your Academic Memory
          </div>
          
          <h1 className="text-5xl md:text-7xl font-serif font-bold tracking-tight text-foreground max-w-4xl mb-8 leading-[1.1]">
            Never lose a lecture detail again.
          </h1>
          
          <p className="text-xl text-muted-foreground max-w-2xl mb-10 leading-relaxed">
            Record, transcribe, and automatically summarize your university lectures. 
            Turn hours of speaking into searchable study notes, definitions, and key points in minutes.
          </p>
          
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <Link href="/sign-up">
              <Button size="lg" className="h-14 px-8 text-lg rounded-full">
                Start Recording Free <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Link>
          </div>
        </section>

        <section className="bg-white py-24 border-t border-border">
          <div className="max-w-7xl mx-auto px-6">
            <div className="grid md:grid-cols-3 gap-12">
              <div className="flex flex-col items-start text-left">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-6">
                  <Mic className="w-7 h-7" />
                </div>
                <h3 className="text-2xl font-serif font-bold mb-3">Record Seamlessly</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Capture lectures directly from your browser. Pause, resume, and bookmark important moments as they happen.
                </p>
              </div>
              
              <div className="flex flex-col items-start text-left">
                <div className="w-14 h-14 rounded-2xl bg-secondary/10 flex items-center justify-center text-secondary mb-6">
                  <FileText className="w-7 h-7" />
                </div>
                <h3 className="text-2xl font-serif font-bold mb-3">Instant Transcripts</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Get high-quality text transcripts immediately after class. Search for exactly what the professor said.
                </p>
              </div>

              <div className="flex flex-col items-start text-left">
                <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center text-accent mb-6">
                  <BrainCircuit className="w-7 h-7" />
                </div>
                <h3 className="text-2xl font-serif font-bold mb-3">AI Summaries</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Automatically extract definitions, key points, and study questions. Build your study guide without typing a word.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="py-8 text-center text-muted-foreground border-t border-border mt-auto">
        <p>© {new Date().getFullYear()} ClassScribe. Build your memory.</p>
      </footer>
    </div>
  );
}
