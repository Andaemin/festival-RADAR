-- Phase 5: MultiYear Planning Assistant의 ReferenceDataPolicy(INCLUDE_PUBLISHED_SAME_YEAR)가
-- 참조하는 연도별 "개최계획 데이터셋 공개 완성" 상태 테이블. Spring
-- MultiYearDatasetPublicationStatus/Value와 스키마 동일. 운영 데이터(연도별 실제 상태)는
-- 여기서 하드코딩하지 않는다 - 별도 seed 스크립트가 채운다. row가 없는 연도는 애플리케이션
-- 로직에서 PARTIAL로 취급한다. production 테이블은 전혀 건드리지 않는다.

-- CreateTable
CREATE TABLE `multi_year_dataset_publication_status` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `datasetYear` INTEGER NOT NULL,
    `status` ENUM('PARTIAL', 'PUBLISHED_PLAN_COMPLETE') NOT NULL,
    `publishedAt` DATETIME(3) NULL,

    UNIQUE INDEX `multi_year_dataset_publication_status_datasetYear_key`(`datasetYear`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
