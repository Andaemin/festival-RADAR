import { PrismaClient } from "../../lib/generated/prisma";
import type { CanonicalRecord } from "./canonicalize";

export interface PersistParams {
  prisma: PrismaClient;
  records: CanonicalRecord[];
  canonicalDatasetSha256: string;
  importerVersion: string;
  sourceFileName: string;
}

export interface PersistYearResult {
  datasetYear: number;
  status: "IMPORTED" | "ALREADY_IMPORTED";
  batchId: number | null;
  insertedRows: number;
}

/** 연도(=source Excel 1개=source_sha256 1개) 단위로 batch를 만들고, 그 batch 하나를
 *  transaction으로 묶어 record + festivalType 관계까지 원자적으로 적재한다. */
export async function persistMultiYearRecords(params: PersistParams): Promise<PersistYearResult[]> {
  const { prisma, records, canonicalDatasetSha256, importerVersion, sourceFileName } = params;

  const byYear = new Map<number, CanonicalRecord[]>();
  for (const r of records) {
    if (!byYear.has(r.datasetYear)) byYear.set(r.datasetYear, []);
    byYear.get(r.datasetYear)!.push(r);
  }

  const results: PersistYearResult[] = [];

  for (const [datasetYear, yearRecords] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    const sourceSha256 = yearRecords[0].sourceSha256;

    const existing = await prisma.multiYearImportBatch.findUnique({
      where: {
        datasetYear_sourceSha256_canonicalDatasetSha256_importerVersion: {
          datasetYear,
          sourceSha256,
          canonicalDatasetSha256,
          importerVersion,
        },
      },
    });

    if (existing) {
      console.log(`[${datasetYear}] 이미 임포트됨 (batchId=${existing.id}) → skip`);
      results.push({ datasetYear, status: "ALREADY_IMPORTED", batchId: existing.id, insertedRows: 0 });
      continue;
    }

    const validCount = yearRecords.filter((r) => r.budgetQualityFlag === "VALID").length;
    const missingCount = yearRecords.filter((r) => r.budgetQualityFlag === "MISSING_OR_NONPOSITIVE").length;
    const suspectCount = yearRecords.filter((r) => r.budgetQualityFlag === "UNIT_SCALE_SUSPECT").length;

    console.log(`[${datasetYear}] ${yearRecords.length}건 적재 시작...`);

    const batchId = await prisma.$transaction(
      async (tx) => {
        const batch = await tx.multiYearImportBatch.create({
          data: {
            datasetYear,
            sourceFileName,
            sourceSha256,
            canonicalDatasetSha256,
            importerVersion,
            totalRows: yearRecords.length,
            validBudgetRows: validCount,
            missingOrNonPositiveRows: missingCount,
            unitScaleSuspectRows: suspectCount,
            status: "SUCCESS",
          },
        });

        let progress = 0;
        for (const r of yearRecords) {
          await tx.multiYearFestivalRecord.create({
            data: {
              datasetYear: r.datasetYear,
              sourceSheet: r.sourceSheet,
              sourceRow: r.sourceRow,
              regionRaw: r.regionRaw,
              region: r.region ?? undefined,
              districtRaw: r.districtRaw,
              district: r.district,
              festivalName: r.festivalName,
              festivalTypeRaw: r.festivalTypeRaw,
              venueRaw: r.venueRaw,
              venueTypeRaw: r.venueTypeRaw,
              venueType: r.venueType ?? undefined,
              periodRaw: r.periodRaw,
              durationDays: r.durationDays,
              durationSource: r.durationSource ?? undefined,
              durationNoteRaw: r.durationNoteRaw,
              cycleRaw: r.cycleRaw,
              cycleType: r.cycleType ?? undefined,
              eventMode: r.eventMode,
              eventStatus: r.eventStatus,
              covidAffected: r.covidAffected,
              firstHeldYear: r.firstHeldYear,
              budgetTotalRaw: r.budgetTotalRaw,
              budgetTotalMillion: r.budgetTotalMillion ?? undefined,
              budgetTotalKrw: r.budgetTotalKrw ?? undefined,
              budgetNationalMillion: r.budgetNationalMillion ?? undefined,
              budgetLocalMillion: r.budgetLocalMillion ?? undefined,
              budgetOtherMillion: r.budgetOtherMillion ?? undefined,
              budgetQualityFlag: r.budgetQualityFlag,
              budgetQualityNote: r.budgetQualityNote,
              visitorTotalPersons: r.visitorTotalPersons,
              importBatchId: batch.id,
              types: {
                create: r.types.map((type) => ({ type })),
              },
            },
          });
          progress++;
          if (progress % 200 === 0) console.log(`  [${datasetYear}] ${progress}/${yearRecords.length}`);
        }

        return batch.id;
      },
      { timeout: 120_000 }
    );

    console.log(`[${datasetYear}] 완료 (batchId=${batchId}, ${yearRecords.length}건)`);
    results.push({ datasetYear, status: "IMPORTED", batchId, insertedRows: yearRecords.length });
  }

  return results;
}
