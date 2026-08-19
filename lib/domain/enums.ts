// 광역자치단체 17개 코드
export enum Region {
  SEOUL = "SEOUL",
  BUSAN = "BUSAN",
  DAEGU = "DAEGU",
  INCHEON = "INCHEON",
  GWANGJU = "GWANGJU",
  DAEJEON = "DAEJEON",
  ULSAN = "ULSAN",
  SEJONG = "SEJONG",
  GYEONGGI = "GYEONGGI",
  GANGWON = "GANGWON",
  CHUNGBUK = "CHUNGBUK",
  CHUNGNAM = "CHUNGNAM",
  JEONBUK = "JEONBUK",
  JEONNAM = "JEONNAM",
  GYEONGBUK = "GYEONGBUK",
  GYEONGNAM = "GYEONGNAM",
  JEJU = "JEJU",
}

export const REGION_DISPLAY: Record<Region, string> = {
  [Region.SEOUL]: "서울",
  [Region.BUSAN]: "부산",
  [Region.DAEGU]: "대구",
  [Region.INCHEON]: "인천",
  [Region.GWANGJU]: "광주",
  [Region.DAEJEON]: "대전",
  [Region.ULSAN]: "울산",
  [Region.SEJONG]: "세종",
  [Region.GYEONGGI]: "경기",
  [Region.GANGWON]: "강원",
  [Region.CHUNGBUK]: "충북",
  [Region.CHUNGNAM]: "충남",
  [Region.JEONBUK]: "전북",
  [Region.JEONNAM]: "전남",
  [Region.GYEONGBUK]: "경북",
  [Region.GYEONGNAM]: "경남",
  [Region.JEJU]: "제주",
};

// 축제 유형 5종
export enum FestivalType {
  CULTURE_ART = "CULTURE_ART",
  NATURE_ECOLOGY = "NATURE_ECOLOGY",
  COMMUNITY = "COMMUNITY",
  TRADITION_HISTORY = "TRADITION_HISTORY",
  LOCAL_SPECIALTY = "LOCAL_SPECIALTY",
}

export const FESTIVAL_TYPE_DISPLAY: Record<FestivalType, string> = {
  [FestivalType.CULTURE_ART]: "문화예술",
  [FestivalType.NATURE_ECOLOGY]: "자연생태",
  [FestivalType.COMMUNITY]: "주민화합",
  [FestivalType.TRADITION_HISTORY]: "전통역사",
  [FestivalType.LOCAL_SPECIALTY]: "지역특산물",
};

// 개최 장소 유형 6종
export enum VenueType {
  VILLAGE = "VILLAGE",
  GREEN = "GREEN",
  WATERFRONT = "WATERFRONT",
  INDEPENDENT = "INDEPENDENT",
  OTHER = "OTHER",
  UNDECIDED = "UNDECIDED",
}

export const VENUE_TYPE_DISPLAY: Record<VenueType, string> = {
  [VenueType.VILLAGE]: "마을형",
  [VenueType.GREEN]: "녹지형",
  [VenueType.WATERFRONT]: "수변형",
  [VenueType.INDEPENDENT]: "독립형",
  [VenueType.OTHER]: "기타",
  [VenueType.UNDECIDED]: "미정",
};

// 예산 상태
export enum BudgetStatus {
  CONFIRMED = "CONFIRMED",
  ZERO = "ZERO",
  UNCONFIRMED = "UNCONFIRMED",
  NO_RESPONSE = "NO_RESPONSE",
}

// 계층형 fallback 단계
export enum FallbackLevel {
  SAME_DISTRICT_TYPE_VENUE = "SAME_DISTRICT_TYPE_VENUE",
  SAME_REGION_TYPE_VENUE = "SAME_REGION_TYPE_VENUE",
  NATIONWIDE_TYPE_VENUE = "NATIONWIDE_TYPE_VENUE",
  SAME_REGION_TYPE = "SAME_REGION_TYPE",
  NATIONWIDE_TYPE = "NATIONWIDE_TYPE",
  GLOBAL_SIMILARITY = "GLOBAL_SIMILARITY",
}

export const FALLBACK_LEVEL_LABEL: Record<FallbackLevel, string> = {
  [FallbackLevel.SAME_DISTRICT_TYPE_VENUE]: "동일 시군구·유형·장소",
  [FallbackLevel.SAME_REGION_TYPE_VENUE]: "동일 시도·유형·장소",
  [FallbackLevel.NATIONWIDE_TYPE_VENUE]: "전국·유형·장소",
  [FallbackLevel.SAME_REGION_TYPE]: "동일 시도·유형",
  [FallbackLevel.NATIONWIDE_TYPE]: "전국·유형",
  [FallbackLevel.GLOBAL_SIMILARITY]: "전체 유사도",
};

export const FALLBACK_LEVEL_ORDER: FallbackLevel[] = [
  FallbackLevel.SAME_DISTRICT_TYPE_VENUE,
  FallbackLevel.SAME_REGION_TYPE_VENUE,
  FallbackLevel.NATIONWIDE_TYPE_VENUE,
  FallbackLevel.SAME_REGION_TYPE,
  FallbackLevel.NATIONWIDE_TYPE,
  FallbackLevel.GLOBAL_SIMILARITY,
];
