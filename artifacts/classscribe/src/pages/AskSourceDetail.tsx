import { Link, useParams } from "wouter";
import {
  getGetClassscribeAskSourceQueryKey,
  useGetClassscribeAskSource,
} from "@workspace/api-client-react";
import type { AskSourceResultKind } from "@workspace/api-client-react";
import { ArrowLeft, BookOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const SOURCE_KINDS: AskSourceResultKind[] = ["note", "assignment", "syllabus"];

function isSourceKind(kind: string | undefined): kind is AskSourceResultKind {
  return SOURCE_KINDS.includes(kind as AskSourceResultKind);
}

export default function AskSourceDetail() {
  const { kind, id } = useParams<{ kind: string; id: string }>();
  const validKind = isSourceKind(kind);
  const sourceKind: AskSourceResultKind = validKind ? kind : "note";
  const sourceQuery = useGetClassscribeAskSource(sourceKind, id ?? "", {
    query: {
      enabled: validKind && !!id,
      queryKey: getGetClassscribeAskSourceQueryKey(sourceKind, id ?? ""),
    },
  });

  return (
    <div className="mx-auto flex max-w-4xl flex-col space-y-6 p-6 md:p-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-3 font-serif text-3xl font-bold text-foreground">
            <BookOpen className="h-7 w-7 text-primary" /> Cited source
          </h1>
          <p className="mt-2 text-muted-foreground">Source content is retrieved securely for your signed-in account.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/ask" data-testid="link-source-back-to-ask"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Ask</Link>
        </Button>
      </div>

      {!validKind || !id ? (
        <p role="alert" className="rounded-md bg-destructive/10 p-4 text-sm text-destructive" data-testid="error-source-invalid">
          This cited source link is invalid.
        </p>
      ) : sourceQuery.isLoading ? (
        <div className="flex items-center gap-3 rounded-md border p-6 text-muted-foreground" role="status" data-testid="status-source-loading">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading source…
        </div>
      ) : sourceQuery.isError ? (
        <p role="alert" className="rounded-md bg-destructive/10 p-4 text-sm text-destructive" data-testid="error-source-load">
          Could not retrieve this source. It may be unavailable or you may not have access to it.
        </p>
      ) : sourceQuery.data ? (
        <Card data-testid="card-ask-source">
          <CardHeader>
            <CardTitle data-testid="text-source-title">{sourceQuery.data.title}</CardTitle>
            <CardDescription>
              {sourceQuery.data.courseName} · {sourceQuery.data.kind}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {sourceQuery.data.truncated && (
              <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground" data-testid="notice-source-truncated">
                This source is long, so only the first section is shown.
              </p>
            )}
            <div className="max-h-[65vh] overflow-auto rounded-md border bg-background p-4 text-sm leading-relaxed text-foreground whitespace-pre-wrap break-words" data-testid="text-source-content">
              {sourceQuery.data.content || "This source has no readable content."}
            </div>
            <Link href={`/courses/${encodeURIComponent(sourceQuery.data.courseId)}`} data-testid="link-source-course" className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline">
              View {sourceQuery.data.courseName}
            </Link>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}