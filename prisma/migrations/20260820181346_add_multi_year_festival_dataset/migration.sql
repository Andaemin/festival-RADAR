-- CreateTable
CREATE TABLE `multi_year_import_batch` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `datasetYear` INTEGER NOT NULL,
    `sourceFileName` VARCHAR(255) NULL,
    `sourceSha256` CHAR(64) NOT NULL,
    `canonicalDatasetSha256` CHAR(64) NOT NULL,
    `importerVersion` VARCHAR(50) NOT NULL,
    `totalRows` INTEGER NOT NULL,
    `validBudgetRows` INTEGER NOT NULL,
    `missingOrNonPositiveRows` INTEGER NOT NULL,
    `unitScaleSuspectRows` INTEGER NOT NULL,
    `importedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` ENUM('SUCCESS', 'FAILED') NOT NULL,
    `errorSummary` TEXT NULL,

    UNIQUE INDEX `multi_year_import_batch_datasetYear_sourceSha256_canonicalDa_key`(`datasetYear`, `sourceSha256`, `canonicalDatasetSha256`, `importerVersion`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `multi_year_festival_record` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `datasetYear` INTEGER NOT NULL,
    `sourceSheet` VARCHAR(50) NOT NULL,
    `sourceRow` INTEGER NOT NULL,
    `regionRaw` VARCHAR(50) NOT NULL,
    `region` ENUM('SEOUL', 'BUSAN', 'DAEGU', 'INCHEON', 'GWANGJU', 'DAEJEON', 'ULSAN', 'SEJONG', 'GYEONGGI', 'GANGWON', 'CHUNGBUK', 'CHUNGNAM', 'JEONBUK', 'JEONNAM', 'GYEONGBUK', 'GYEONGNAM', 'JEJU') NULL,
    `districtRaw` VARCHAR(100) NULL,
    `district` VARCHAR(50) NULL,
    `festivalName` VARCHAR(255) NOT NULL,
    `festivalTypeRaw` VARCHAR(200) NULL,
    `venueRaw` VARCHAR(255) NULL,
    `venueTypeRaw` VARCHAR(50) NULL,
    `venueType` ENUM('VILLAGE', 'GREEN', 'WATERFRONT', 'INDEPENDENT', 'OTHER', 'UNDECIDED') NULL,
    `periodRaw` VARCHAR(255) NULL,
    `durationDays` INTEGER NULL,
    `durationSource` ENUM('EXPLICIT_TEXT', 'SOURCE_TOTAL_DAYS', 'UNPARSED') NULL,
    `durationNoteRaw` VARCHAR(255) NULL,
    `cycleRaw` VARCHAR(100) NULL,
    `cycleType` ENUM('ANNUAL', 'BIENNIAL', 'ONE_TIME', 'FIRST_TIME') NULL,
    `eventMode` VARCHAR(255) NULL,
    `eventStatus` VARCHAR(255) NULL,
    `covidAffected` BOOLEAN NOT NULL DEFAULT false,
    `firstHeldYear` INTEGER NULL,
    `budgetTotalRaw` VARCHAR(50) NULL,
    `budgetTotalMillion` DECIMAL(14, 2) NULL,
    `budgetTotalKrw` BIGINT NULL,
    `budgetNationalMillion` DECIMAL(14, 2) NULL,
    `budgetLocalMillion` DECIMAL(14, 2) NULL,
    `budgetOtherMillion` DECIMAL(14, 2) NULL,
    `budgetQualityFlag` ENUM('VALID', 'MISSING_OR_NONPOSITIVE', 'UNIT_SCALE_SUSPECT') NOT NULL,
    `budgetQualityNote` VARCHAR(255) NULL,
    `visitorTotalPersons` INTEGER NULL,
    `importBatchId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `multi_year_festival_record_datasetYear_idx`(`datasetYear`),
    INDEX `multi_year_festival_record_importBatchId_idx`(`importBatchId`),
    INDEX `multi_year_festival_record_region_idx`(`region`),
    UNIQUE INDEX `multi_year_festival_record_importBatchId_sourceSheet_sourceR_key`(`importBatchId`, `sourceSheet`, `sourceRow`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `multi_year_festival_record_type` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `recordId` INTEGER NOT NULL,
    `type` ENUM('CULTURE_ART', 'NATURE_ECOLOGY', 'COMMUNITY', 'TRADITION_HISTORY', 'LOCAL_SPECIALTY', 'OTHER', 'UNKNOWN') NOT NULL,

    UNIQUE INDEX `multi_year_festival_record_type_recordId_type_key`(`recordId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `multi_year_festival_record` ADD CONSTRAINT `multi_year_festival_record_importBatchId_fkey` FOREIGN KEY (`importBatchId`) REFERENCES `multi_year_import_batch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `multi_year_festival_record_type` ADD CONSTRAINT `multi_year_festival_record_type_recordId_fkey` FOREIGN KEY (`recordId`) REFERENCES `multi_year_festival_record`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
