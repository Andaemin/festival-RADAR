/**
 * 한국관광공사 관광지 집중률 방문자 추이 예측 정보 API
 *
 * 엔드포인트: https://apis.data.go.kr/B551011/TatsCnctrRateService/tatsCnctrRatedList
 * KT 이동통신 데이터 기반 ML 예측 — 향후 30일간 관광지별 집중률(0~100)을 반환한다.
 * 집중률이 높을수록 방문자 집중이 예상됨.
 *
 * 코드 체계: 행정표준코드 (TourAPI areaCode와 다름)
 *   areaCd: 시도 2자리 (11=서울, 26=부산, …)
 *   signguCd: 시군구 5자리 (11110=종로구, 26110=부산중구, …)
 */

const BASE_URL =
    "https://apis.data.go.kr/B551011/TatsCnctrRateService/tatsCnctrRatedList";

export interface ConcentrationItem {
    baseYmd: string;
    areaCd: string;
    areaNm: string;
    signguCd: string;
    signguNm: string;
    tAtsNm: string;
    cnctrRate: string;
}

export interface ConcentrationResponse {
    items: ConcentrationItem[];
    totalCount: number;
    pageNo: number;
    numOfRows: number;
}

export async function fetchConcentrationRates(params: {
    areaCd: string;
    signguCd: string;
    tAtsNm?: string;
    pageNo?: number;
    numOfRows?: number;
}): Promise<ConcentrationResponse> {
    const serviceKey = process.env.TOUR_API_SERVICE_KEY;
    if (!serviceKey) throw new Error("TOUR_API_SERVICE_KEY가 설정되지 않았습니다.");

    const url = new URL(BASE_URL);
    url.searchParams.set("serviceKey", serviceKey);
    url.searchParams.set("MobileOS", "ETC");
    url.searchParams.set("MobileApp", "festival-radar");
    url.searchParams.set("_type", "json");
    url.searchParams.set("pageNo", String(params.pageNo ?? 1));
    url.searchParams.set("numOfRows", String(params.numOfRows ?? 100));
    url.searchParams.set("areaCd", params.areaCd);
    url.searchParams.set("signguCd", params.signguCd);
    if (params.tAtsNm) url.searchParams.set("tAtsNm", params.tAtsNm);

    const res = await fetch(url.toString(), { cache: "no-store" });
    const text = await res.text();

    if (text.trimStart().startsWith("<") || text.includes("OpenAPI_ServiceResponse")) {
        const msg = /<returnAuthMsg>([^<]*)<\/returnAuthMsg>/.exec(text)?.[1] ?? text.slice(0, 160);
        throw new Error(`집중률 API 오류: ${msg}`);
    }

    const json = JSON.parse(text);
    const body = json?.response?.body;
    if (!body) throw new Error("집중률 API: 응답 형식 오류");

    const raw = body.items?.item;
    const items: ConcentrationItem[] = !raw ? [] : Array.isArray(raw) ? raw : [raw];

    return {
        items,
        totalCount: body.totalCount ?? 0,
        pageNo: body.pageNo ?? 1,
        numOfRows: body.numOfRows ?? 0,
    };
}

/** 시도 코드 목록 (행정표준코드) */
export const AREA_CODES = [
    { code: "11", name: "서울특별시" },
    { code: "26", name: "부산광역시" },
    { code: "27", name: "대구광역시" },
    { code: "28", name: "인천광역시" },
    { code: "29", name: "광주광역시" },
    { code: "30", name: "대전광역시" },
    { code: "31", name: "울산광역시" },
    { code: "36", name: "세종특별자치시" },
    { code: "41", name: "경기도" },
    { code: "43", name: "충청북도" },
    { code: "44", name: "충청남도" },
    { code: "46", name: "전라남도" },
    { code: "47", name: "경상북도" },
    { code: "48", name: "경상남도" },
    { code: "50", name: "제주특별자치도" },
    { code: "51", name: "강원특별자치도" },
    { code: "52", name: "전북특별자치도" },
] as const;

/** 시군구 코드 목록 (행정표준코드, 주요 지역) */
export const SIGNGU_CODES: Record<string, { code: string; name: string }[]> = {
    "11": [
        { code: "11110", name: "종로구" }, { code: "11140", name: "중구" },
        { code: "11170", name: "용산구" }, { code: "11200", name: "성동구" },
        { code: "11215", name: "광진구" }, { code: "11230", name: "동대문구" },
        { code: "11260", name: "중랑구" }, { code: "11290", name: "성북구" },
        { code: "11305", name: "강북구" }, { code: "11320", name: "도봉구" },
        { code: "11350", name: "노원구" }, { code: "11380", name: "은평구" },
        { code: "11410", name: "서대문구" }, { code: "11440", name: "마포구" },
        { code: "11470", name: "양천구" }, { code: "11500", name: "강서구" },
        { code: "11530", name: "구로구" }, { code: "11545", name: "금천구" },
        { code: "11560", name: "영등포구" }, { code: "11590", name: "동작구" },
        { code: "11620", name: "관악구" }, { code: "11650", name: "서초구" },
        { code: "11680", name: "강남구" }, { code: "11710", name: "송파구" },
        { code: "11740", name: "강동구" },
    ],
    "26": [
        { code: "26110", name: "중구" }, { code: "26140", name: "서구" },
        { code: "26170", name: "동구" }, { code: "26200", name: "영도구" },
        { code: "26230", name: "부산진구" }, { code: "26260", name: "동래구" },
        { code: "26290", name: "남구" }, { code: "26320", name: "북구" },
        { code: "26350", name: "해운대구" }, { code: "26380", name: "사하구" },
        { code: "26410", name: "금정구" }, { code: "26440", name: "강서구" },
        { code: "26470", name: "연제구" }, { code: "26500", name: "수영구" },
        { code: "26530", name: "사상구" }, { code: "26710", name: "기장군" },
    ],
    "27": [
        { code: "27110", name: "중구" }, { code: "27140", name: "동구" },
        { code: "27170", name: "서구" }, { code: "27200", name: "남구" },
        { code: "27230", name: "북구" }, { code: "27260", name: "수성구" },
        { code: "27290", name: "달서구" }, { code: "27710", name: "달성군" },
    ],
    "28": [
        { code: "28110", name: "중구" }, { code: "28140", name: "동구" },
        { code: "28177", name: "미추홀구" }, { code: "28185", name: "연수구" },
        { code: "28200", name: "남동구" }, { code: "28237", name: "부평구" },
        { code: "28245", name: "계양구" }, { code: "28260", name: "서구" },
        { code: "28710", name: "강화군" }, { code: "28720", name: "옹진군" },
    ],
    "29": [
        { code: "29110", name: "동구" }, { code: "29140", name: "서구" },
        { code: "29155", name: "남구" }, { code: "29170", name: "북구" },
        { code: "29200", name: "광산구" },
    ],
    "30": [
        { code: "30110", name: "동구" }, { code: "30140", name: "중구" },
        { code: "30170", name: "서구" }, { code: "30200", name: "유성구" },
        { code: "30230", name: "대덕구" },
    ],
    "31": [
        { code: "31110", name: "중구" }, { code: "31140", name: "남구" },
        { code: "31170", name: "동구" }, { code: "31200", name: "북구" },
        { code: "31710", name: "울주군" },
    ],
    "36": [
        { code: "36110", name: "세종특별자치시" },
    ],
    "41": [
        { code: "41111", name: "수원시 장안구" }, { code: "41113", name: "수원시 권선구" },
        { code: "41115", name: "수원시 팔달구" }, { code: "41117", name: "수원시 영통구" },
        { code: "41131", name: "성남시 수정구" }, { code: "41133", name: "성남시 중원구" },
        { code: "41135", name: "성남시 분당구" }, { code: "41150", name: "의정부시" },
        { code: "41171", name: "안양시 만안구" }, { code: "41173", name: "안양시 동안구" },
        { code: "41190", name: "부천시" }, { code: "41210", name: "광명시" },
        { code: "41220", name: "평택시" }, { code: "41250", name: "동두천시" },
        { code: "41271", name: "안산시 상록구" }, { code: "41273", name: "안산시 단원구" },
        { code: "41281", name: "고양시 덕양구" }, { code: "41285", name: "고양시 일산동구" },
        { code: "41287", name: "고양시 일산서구" }, { code: "41290", name: "과천시" },
        { code: "41310", name: "구리시" }, { code: "41360", name: "남양주시" },
        { code: "41370", name: "오산시" }, { code: "41390", name: "시흥시" },
        { code: "41410", name: "군포시" }, { code: "41430", name: "의왕시" },
        { code: "41450", name: "하남시" }, { code: "41461", name: "용인시 처인구" },
        { code: "41463", name: "용인시 기흥구" }, { code: "41465", name: "용인시 수지구" },
        { code: "41480", name: "파주시" }, { code: "41500", name: "이천시" },
        { code: "41550", name: "안성시" }, { code: "41570", name: "김포시" },
        { code: "41590", name: "화성시" }, { code: "41610", name: "광주시" },
        { code: "41630", name: "양주시" }, { code: "41650", name: "포천시" },
        { code: "41670", name: "여주시" }, { code: "41800", name: "연천군" },
        { code: "41820", name: "가평군" }, { code: "41830", name: "양평군" },
    ],
    "43": [
        { code: "43111", name: "청주시 상당구" }, { code: "43112", name: "청주시 서원구" },
        { code: "43113", name: "청주시 흥덕구" }, { code: "43114", name: "청주시 청원구" },
        { code: "43130", name: "충주시" }, { code: "43150", name: "제천시" },
        { code: "43720", name: "보은군" }, { code: "43730", name: "옥천군" },
        { code: "43740", name: "영동군" }, { code: "43750", name: "증평군" },
        { code: "43760", name: "진천군" }, { code: "43770", name: "괴산군" },
        { code: "43800", name: "음성군" }, { code: "43810", name: "단양군" },
    ],
    "44": [
        { code: "44131", name: "천안시 동남구" }, { code: "44133", name: "천안시 서북구" },
        { code: "44150", name: "공주시" }, { code: "44180", name: "보령시" },
        { code: "44200", name: "아산시" }, { code: "44210", name: "서산시" },
        { code: "44230", name: "논산시" }, { code: "44250", name: "계룡시" },
        { code: "44270", name: "당진시" }, { code: "44710", name: "금산군" },
        { code: "44760", name: "부여군" }, { code: "44770", name: "서천군" },
        { code: "44790", name: "청양군" }, { code: "44800", name: "홍성군" },
        { code: "44810", name: "예산군" }, { code: "44825", name: "태안군" },
    ],
    "46": [
        { code: "46110", name: "목포시" }, { code: "46130", name: "여수시" },
        { code: "46150", name: "순천시" }, { code: "46170", name: "나주시" },
        { code: "46230", name: "광양시" }, { code: "46710", name: "담양군" },
        { code: "46720", name: "곡성군" }, { code: "46730", name: "구례군" },
        { code: "46770", name: "영광군" }, { code: "46780", name: "장성군" },
        { code: "46800", name: "완도군" }, { code: "46810", name: "진도군" },
        { code: "46820", name: "신안군" }, { code: "46860", name: "해남군" },
        { code: "46870", name: "영암군" }, { code: "46880", name: "무안군" },
        { code: "46900", name: "보성군" }, { code: "46910", name: "화순군" },
        { code: "46930", name: "장흥군" }, { code: "46940", name: "강진군" },
    ],
    "47": [
        { code: "47111", name: "포항시 남구" }, { code: "47113", name: "포항시 북구" },
        { code: "47130", name: "경주시" }, { code: "47150", name: "김천시" },
        { code: "47170", name: "안동시" }, { code: "47190", name: "구미시" },
        { code: "47210", name: "영주시" }, { code: "47230", name: "영천시" },
        { code: "47250", name: "상주시" }, { code: "47280", name: "문경시" },
        { code: "47290", name: "경산시" }, { code: "47720", name: "군위군" },
        { code: "47730", name: "의성군" }, { code: "47750", name: "청송군" },
        { code: "47760", name: "영양군" }, { code: "47770", name: "영덕군" },
        { code: "47820", name: "청도군" }, { code: "47830", name: "고령군" },
        { code: "47840", name: "성주군" }, { code: "47850", name: "칠곡군" },
        { code: "47900", name: "예천군" }, { code: "47920", name: "봉화군" },
        { code: "47930", name: "울진군" }, { code: "47940", name: "울릉군" },
    ],
    "48": [
        { code: "48121", name: "창원시 의창구" }, { code: "48123", name: "창원시 성산구" },
        { code: "48125", name: "창원시 마산합포구" }, { code: "48127", name: "창원시 마산회원구" },
        { code: "48129", name: "창원시 진해구" }, { code: "48170", name: "진주시" },
        { code: "48220", name: "통영시" }, { code: "48240", name: "사천시" },
        { code: "48250", name: "김해시" }, { code: "48270", name: "밀양시" },
        { code: "48310", name: "거제시" }, { code: "48330", name: "양산시" },
        { code: "48720", name: "의령군" }, { code: "48730", name: "함안군" },
        { code: "48740", name: "창녕군" }, { code: "48820", name: "고성군" },
        { code: "48840", name: "남해군" }, { code: "48850", name: "하동군" },
        { code: "48860", name: "산청군" }, { code: "48870", name: "함양군" },
        { code: "48880", name: "거창군" }, { code: "48890", name: "합천군" },
    ],
    "50": [
        { code: "50110", name: "제주시" }, { code: "50130", name: "서귀포시" },
    ],
    "51": [
        { code: "51110", name: "춘천시" }, { code: "51130", name: "원주시" },
        { code: "51150", name: "강릉시" }, { code: "51170", name: "동해시" },
        { code: "51190", name: "태백시" }, { code: "51210", name: "속초시" },
        { code: "51230", name: "삼척시" }, { code: "51720", name: "홍천군" },
        { code: "51730", name: "횡성군" }, { code: "51750", name: "영월군" },
        { code: "51760", name: "평창군" }, { code: "51770", name: "정선군" },
        { code: "51780", name: "철원군" }, { code: "51790", name: "화천군" },
        { code: "51800", name: "양구군" }, { code: "51810", name: "인제군" },
        { code: "51820", name: "고성군" }, { code: "51830", name: "양양군" },
    ],
    "52": [
        { code: "52111", name: "전주시 완산구" }, { code: "52113", name: "전주시 덕진구" },
        { code: "52130", name: "군산시" }, { code: "52140", name: "익산시" },
        { code: "52180", name: "정읍시" }, { code: "52190", name: "남원시" },
        { code: "52210", name: "김제시" }, { code: "52710", name: "완주군" },
        { code: "52720", name: "진안군" }, { code: "52730", name: "무주군" },
        { code: "52740", name: "장수군" }, { code: "52750", name: "임실군" },
        { code: "52770", name: "순창군" }, { code: "52790", name: "고창군" },
        { code: "52800", name: "부안군" },
    ],
};
