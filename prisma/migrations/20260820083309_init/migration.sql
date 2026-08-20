-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `role` ENUM('ADMIN', 'USER') NOT NULL DEFAULT 'USER',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `users_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dataset_import_batch` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `datasetYear` INTEGER NOT NULL,
    `originalFileName` VARCHAR(255) NOT NULL,
    `fileHash` CHAR(64) NOT NULL,
    `totalRows` INTEGER NOT NULL,
    `validBudgetRows` INTEGER NOT NULL,
    `invalidRows` INTEGER NOT NULL,
    `importedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` ENUM('SUCCESS', 'FAILED') NOT NULL,
    `errorSummary` TEXT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `festival_record` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `datasetYear` INTEGER NOT NULL,
    `sourceRowNumber` INTEGER NOT NULL,
    `festivalName` VARCHAR(255) NOT NULL,
    `region` ENUM('SEOUL', 'BUSAN', 'DAEGU', 'INCHEON', 'GWANGJU', 'DAEJEON', 'ULSAN', 'SEJONG', 'GYEONGGI', 'GANGWON', 'CHUNGBUK', 'CHUNGNAM', 'JEONBUK', 'JEONNAM', 'GYEONGBUK', 'GYEONGNAM', 'JEJU') NOT NULL,
    `regionName` VARCHAR(20) NOT NULL,
    `administrativeDistrict` VARCHAR(50) NULL,
    `festivalType` ENUM('CULTURE_ART', 'NATURE_ECOLOGY', 'COMMUNITY', 'TRADITION_HISTORY', 'LOCAL_SPECIALTY') NOT NULL,
    `venueName` VARCHAR(255) NULL,
    `venueType` ENUM('VILLAGE', 'GREEN', 'WATERFRONT', 'INDEPENDENT', 'OTHER', 'UNDECIDED') NOT NULL,
    `venueRegion` VARCHAR(20) NULL,
    `venueDistrict` VARCHAR(50) NULL,
    `startYear` INTEGER NULL,
    `startMonth` INTEGER NULL,
    `startDay` INTEGER NULL,
    `endYear` INTEGER NULL,
    `endMonth` INTEGER NULL,
    `endDay` INTEGER NULL,
    `durationDays` INTEGER NULL,
    `durationSource` ENUM('REPORTED', 'CALCULATED', 'UNKNOWN') NULL,
    `durationNote` VARCHAR(255) NULL,
    `cycleType` ENUM('ANNUAL', 'BIENNIAL', 'ONE_TIME', 'FIRST_TIME') NOT NULL,
    `firstHeldYear` INTEGER NULL,
    `firstHeldYearNote` VARCHAR(20) NULL,
    `totalBudgetKrw` BIGINT NULL,
    `nationalBudgetKrw` BIGINT NULL,
    `localBudgetKrw` BIGINT NULL,
    `otherBudgetKrw` BIGINT NULL,
    `budgetStatus` ENUM('CONFIRMED', 'ZERO', 'UNCONFIRMED', 'NO_RESPONSE') NOT NULL,
    `previousVisitors` INTEGER NULL,
    `previousVisitorsStatus` ENUM('NOT_TALLIED', 'FIRST_TIME_HELD', 'RECENTLY_NOT_HELD', 'UNKNOWN') NULL,
    `domesticVisitors` INTEGER NULL,
    `domesticVisitorsStatus` ENUM('NOT_TALLIED', 'FIRST_TIME_HELD', 'RECENTLY_NOT_HELD', 'UNKNOWN') NULL,
    `foreignVisitors` INTEGER NULL,
    `foreignVisitorsStatus` ENUM('NOT_TALLIED', 'FIRST_TIME_HELD', 'RECENTLY_NOT_HELD', 'UNKNOWN') NULL,
    `visitorMeasurementMethod` ENUM('MEASURED', 'ESTIMATED', 'NOT_TALLIED', 'OTHER', 'NO_RESPONSE') NULL,
    `importBatchId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `festival_record_datasetYear_idx`(`datasetYear`),
    INDEX `festival_record_importBatchId_idx`(`importBatchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `festival_record` ADD CONSTRAINT `festival_record_importBatchId_fkey` FOREIGN KEY (`importBatchId`) REFERENCES `dataset_import_batch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
