import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetStudyGuideQueryKey, useGenerateStudyGuide, useGetStudyGuide } from "@workspace/api-client-react";
import { Link } from "wouter";
import { BookOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function StudyGuidePanel({ courseId }: { courseId: string }) {
  const client = useQueryClient();
  const guideQuery = useGetStudyGuide(courseId, { query: { enabled: !!courseId, queryKey: getGetStudyGuideQueryKey(courseId) } });
  const generate = useGenerateStudyGuide();
  const [error, setError] = useState("");
  const guide = guideQuery.data?.guide;

  async function createGuide() {
    setError("");
    try {
      const saved = await generate.mutateAsync({ id: courseId });
      client.setQueryData(getGetStudyGuideQueryKey(courseId), { guide: saved });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not generate the guide. Please try again.");
    }
  }

  return <Card className="border-border">
    <CardHeader>
      <CardTitle className="flex items-center gap-2"><BookOpen className="w-5 h-5 text-primary" /> Study guide</CardTitle>
      <p className="text-sm text-muted-foreground">A course-wide review based on your lectures and your private course notes. It does not predict exam content.</p>
    </CardHeader>
    <CardContent className="space-y-5">
      <Button onClick={createGuide} disabled={generate.isPending || !courseId}>
        {generate.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
        {generate.isPending ? "Generating guide…" : guide ? "Regenerate study guide" : "Generate study guide"}
      </Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {guideQuery.isPending && <p className="text-sm text-muted-foreground">Loading saved guide…</p>}
      {guideQuery.isError && <p role="alert" className="text-sm text-destructive">Could not load the saved guide. Try selecting this course again.</p>}
      {guide ? <div className="space-y-5">
        <p className="text-xs text-muted-foreground">Saved {new Date(guide.updatedAt).toLocaleString()}</p>
        <div className="space-y-2 text-sm leading-relaxed">
          {guide.content.split("\n").map((line, index) => {
            const heading = line.match(/^#{1,3}\s+(.+)/);
            if (heading) return <h3 key={index} className="text-lg font-bold mt-5">{heading[1]}</h3>;
            if (!line.trim()) return null;
            return <p key={index} className={/^\s*[-*]\s/.test(line) ? "pl-4" : ""}>{line}</p>;
          })}
        </div>
        {guide.sources.length > 0 && <div className="border-t pt-4 space-y-2">
          <h3 className="font-semibold">Lecture sources</h3>
          {guide.sources.map((source, i) => <div key={source.id} className="text-sm">
            <Link href={`/lectures/${source.id}`} className="text-primary underline underline-offset-2">[{i + 1}] {source.title}</Link>
          </div>)}
        </div>}
      </div> : !guideQuery.isPending && !guideQuery.isError && !generate.isPending &&
        <p className="text-sm text-muted-foreground">No guide saved for this course yet.</p>}
    </CardContent>
  </Card>;
}