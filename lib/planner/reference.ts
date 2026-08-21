import {
    FESTIVAL_TYPE_DISPLAY,
    FestivalType,
    REGION_DISPLAY,
    Region,
    VENUE_TYPE_DISPLAY,
    VenueType,
} from "@/lib/domain/enums";
import { PlannerRecord, ReferenceFestival } from "./types";

/** 내부 레코드를 화면·API에 그대로 내보낼 수 있는 근거 축제 DTO로 바꾼다. */
export function toReferenceFestival(record: PlannerRecord): ReferenceFestival {
    const costPerVisitorKrw =
        record.totalBudgetKrw !== null && record.visitors !== null && record.visitors > 0
            ? Math.round(record.totalBudgetKrw / record.visitors)
            : null;

    return {
        festivalName: record.festivalName,
        regionLabel: REGION_DISPLAY[record.region as Region] ?? record.region,
        district: record.district,
        festivalTypeLabel:
            FESTIVAL_TYPE_DISPLAY[record.festivalType as FestivalType] ?? record.festivalType,
        venueTypeLabel: VENUE_TYPE_DISPLAY[record.venueType as VenueType] ?? record.venueType,
        startMonth: record.startMonth,
        durationDays: record.durationDays,
        totalBudgetKrw: record.totalBudgetKrw,
        visitors: record.visitors,
        costPerVisitorKrw,
    };
}
