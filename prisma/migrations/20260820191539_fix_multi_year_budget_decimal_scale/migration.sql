-- precision fix: Decimal(14,2) -> Decimal(18,3) on MultiYear budget columns only.
-- Spring MultiYearFestivalRecord의 @Column(precision=18, scale=3)과 scale을 일치시킨다.
-- forensic 대조로 확인된 실제 버그(42.85714285714286 -> 42.86으로 반올림되며 정밀도 손실)를 고친다.
-- 기존 데이터는 importer 재실행(IMPORTER_VERSION 1.0.1)으로 전량 재적재하므로 여기서는 컬럼
-- 타입만 바꾼다. production `festival_record`/`dataset_import_batch` 테이블은 전혀 건드리지 않는다.

-- AlterTable
ALTER TABLE `multi_year_festival_record`
    MODIFY `budgetTotalMillion` DECIMAL(18, 3) NULL,
    MODIFY `budgetNationalMillion` DECIMAL(18, 3) NULL,
    MODIFY `budgetLocalMillion` DECIMAL(18, 3) NULL,
    MODIFY `budgetOtherMillion` DECIMAL(18, 3) NULL;
