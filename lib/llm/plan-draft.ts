import OpenAI from "openai";
import { LlmPlanDraft, Recommendation } from "@/lib/planner/types";
import type { TourApiFestivalDetail } from "@/lib/external/tour-api";

/**
 * 통계 엔진이 만든 근거(evidence)를 받아 기획안 서술로 옮긴다.
 *
 * 설계 원칙: **LLM에게 수치를 만들게 하지 않는다.** 건수·예산·방문객은 전부 DB에서 계산해
 * 프롬프트에 넣고, 모델은 그것을 조합해 콘셉트와 프로그램 아이디어를 쓰는 역할만 한다.
 * 이렇게 해야 화면의 숫자가 항상 검증 가능하다.
 *
 * 필요한 환경변수:
 *   OPENAI_API_KEY  OpenAI 인증키
 *   OPENAI_MODEL    (선택) 사용할 모델. 기본값 gpt-5.5
 */

const DEFAULT_MODEL = "gpt-5.5";

export function isLlmEnabled(): boolean {
    return !!process.env.OPENAI_API_KEY;
}

export interface PlanDraftInput {
    regionLabel: string;
    typeLabel: string;
    planningYear: number;
    recommendations: Recommendation[];
    saturationMessage: string | null;
    medianCostPerVisitorKrw: number | null;
    tourApiDetails: TourApiFestivalDetail[];
}

const SYSTEM_PROMPT = `당신은 한국 지역축제 기획 컨설턴트입니다.

규칙:
1. 제공된 "분석 근거"에 있는 수치만 사용하세요. 건수·예산·방문객 수를 새로 지어내지 마세요.
2. 근거에 없는 통계를 언급해야 할 것 같으면, 수치 없이 정성적으로만 쓰세요.
3. 한국 지자체 축제 기획 실무에 맞는 구체적인 프로그램을 제안하세요.
4. 반드시 아래 JSON 스키마로만 답하세요. 다른 텍스트를 덧붙이지 마세요.

{
  "concept": "축제 콘셉트 한 문단",
  "programIdeas": ["구체적 프로그램 3~5개"],
  "differentiationPoints": ["기존 축제와 다른 점 2~4개"],
  "cautions": ["기획 시 유의사항 2~3개"]
}`;

function buildUserPrompt(input: PlanDraftInput): string {
    const lines: string[] = [
        `## 기획 조건`,
        `- 지역: ${input.regionLabel}`,
        `- 유형: ${input.typeLabel}`,
        `- 개최 예정 연도: ${input.planningYear}년`,
        ``,
        `## 분석 근거 (DB 실측값 - 이 수치만 인용 가능)`,
    ];

    for (const rec of input.recommendations) {
        lines.push(`### ${rec.title} (기회점수 ${rec.opportunityScore})`);
        lines.push(rec.summary);
        for (const r of rec.rationale) lines.push(`- ${r}`);
        if (rec.referenceFestivals.length > 0) {
            lines.push(
                `- 참고 축제: ${rec.referenceFestivals
                    .map((f) => `${f.festivalName}(${f.regionLabel}, ${f.startMonth ?? "?"}월, 방문객 ${f.visitors ?? "미상"}명)`)
                    .join(" / ")}`
            );
        }
        lines.push("");
    }

    if (input.saturationMessage) lines.push(`### 포화도\n${input.saturationMessage}\n`);
    if (input.medianCostPerVisitorKrw !== null) {
        lines.push(`### 예산 기준선\n1인당 투입비 중앙값 ${input.medianCostPerVisitorKrw.toLocaleString("ko-KR")}원\n`);
    }

    if (input.tourApiDetails.length > 0) {
        lines.push(`## 유사 축제의 실제 프로그램 (TourAPI)`);
        for (const d of input.tourApiDetails) {
            lines.push(`### ${d.title}`);
            if (d.overview) lines.push(`개요: ${d.overview.slice(0, 500)}`);
            if (d.program) lines.push(`프로그램: ${d.program.slice(0, 500)}`);
            lines.push("");
        }
    }

    return lines.join("\n");
}

export async function generatePlanDraft(input: PlanDraftInput): Promise<LlmPlanDraft> {
    const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await client.chat.completions.create({
        model,
        response_format: { type: "json_object" },
        messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildUserPrompt(input) },
        ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("LLM이 빈 응답을 반환했습니다.");

    const parsed = JSON.parse(content) as Partial<LlmPlanDraft>;

    const asStringArray = (v: unknown): string[] =>
        Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

    return {
        model,
        concept: typeof parsed.concept === "string" ? parsed.concept : "",
        programIdeas: asStringArray(parsed.programIdeas),
        differentiationPoints: asStringArray(parsed.differentiationPoints),
        cautions: asStringArray(parsed.cautions),
    };
}
