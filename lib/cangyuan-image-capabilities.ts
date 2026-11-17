export type CangyuanImageParameterProfile = {
  readonly nMax?: number;
  readonly supportsSize: boolean;
  readonly sizeEnum: readonly string[];
  readonly sizeRecommendations: readonly string[];
  readonly qualityEnum: readonly string[];
  readonly backgroundEnum: readonly string[];
  readonly outputFormatEnum: readonly string[];
  readonly imagesMaxItems?: number;
  readonly supportsMask: boolean;
  readonly supportsAspectRatio: boolean;
  readonly aspectRatioEnum: readonly string[];
  readonly aspectRatioRecommendations: readonly string[];
};

export type CangyuanImageModelProfile = CangyuanImageParameterProfile & {
  readonly publicModel: string;
};

// Derived from each public Image model entry and its models/*.json parameter schema.
const PROFILE_SETS: readonly CangyuanImageParameterProfile[] = [
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["auto","1K","2K","4K","1024x1024","1536x1024","1024x1536","2048x2048","2560x1440","1440x2560","3840x2160","2160x3840","2880x2880"],"qualityEnum":["medium","low","high","auto"],"backgroundEnum":["opaque","auto"],"outputFormatEnum":["png","jpeg","webp"],"imagesMaxItems":14,"supportsMask":true,"supportsAspectRatio":true,"aspectRatioEnum":[],"aspectRatioRecommendations":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9"]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["auto","1K","2K","4K","1024x1024","1536x1024","1024x1536","2048x2048","2560x1440","1440x2560","3840x2160","2160x3840","2880x2880"],"qualityEnum":["medium","low","high","xhigh","max","auto"],"backgroundEnum":["transparent","opaque","auto"],"outputFormatEnum":["png","jpeg","webp"],"imagesMaxItems":16,"supportsMask":true,"supportsAspectRatio":true,"aspectRatioEnum":[],"aspectRatioRecommendations":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9"]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["auto","1K","2K","4K","1024x1024","1536x1024","1024x1536","2048x2048","2560x1440","1440x2560","3840x2160","2160x3840","2880x2880"],"qualityEnum":["medium","low","high","xhigh","max","auto"],"backgroundEnum":["transparent","opaque","auto"],"outputFormatEnum":["png","jpeg","webp","gif"],"imagesMaxItems":16,"supportsMask":true,"supportsAspectRatio":true,"aspectRatioEnum":[],"aspectRatioRecommendations":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9"]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","1024x1024","3:2","1536x1024","16:9","1536x864","4:3","1536x1152","3:4","1152x1536","5:4","1280x1024","4:5","1024x1280","21:9","1536x656","9:21","656x1536","2:3","1024x1536","auto","9:16","1:3","3:1"],"qualityEnum":[],"backgroundEnum":["auto","opaque","transparent"],"outputFormatEnum":[],"imagesMaxItems":9,"supportsMask":false,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","5:4","7:6","9:16","21:9","9:21","16:9","3:2","4:3","4:5","3:4","2:3","1:3","3:1"],"qualityEnum":["medium","low","high","xhigh","max"],"backgroundEnum":[],"outputFormatEnum":["png","jpeg","webp"],"imagesMaxItems":9,"supportsMask":false,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","5:4","7:6","9:16","9:21","16:9","3:2","4:3","4:5","3:4","2:3","1:3","3:1","21:9"],"qualityEnum":["medium","low","high","xhigh","max"],"backgroundEnum":[],"outputFormatEnum":["png","jpeg","webp"],"imagesMaxItems":9,"supportsMask":false,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","1024x1024","3:2","1536x1024","16:9","1536x864","4:3","1536x1152","3:4","1152x1536","5:4","1280x1024","4:5","1024x1280","21:9","1536x656","9:21","656x1536","2:3","1024x1536","auto","9:16"],"qualityEnum":["medium","low","high","xhigh","max"],"backgroundEnum":["auto","opaque","transparent"],"outputFormatEnum":[],"imagesMaxItems":9,"supportsMask":true,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","5:4","7:6","9:16","21:9","9:21","16:9","3:2","4:3","4:5","3:4","2:3"],"qualityEnum":["medium","low","high","xhigh","max"],"backgroundEnum":["auto","opaque","transparent"],"outputFormatEnum":["png","jpeg","webp"],"imagesMaxItems":16,"supportsMask":false,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","1024x1024","3:2","1536x1024","16:9","1536x864","4:3","1536x1152","3:4","1152x1536","5:4","1280x1024","4:5","1024x1280","21:9","1536x656","9:21","656x1536","2:3","1024x1536","auto","9:16","1:3","3:1"],"qualityEnum":[],"backgroundEnum":["auto","opaque","transparent"],"outputFormatEnum":["png","jpeg","webp","gif"],"imagesMaxItems":9,"supportsMask":false,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","1024x1024","3:2","1536x1024","16:9","1536x864","4:3","1536x1152","3:4","1152x1536","5:4","1280x1024","4:5","1024x1280","21:9","1536x656","9:21","656x1536","2:3","1024x1536","auto","9:16","1:3","3:1"],"qualityEnum":[],"backgroundEnum":["auto","opaque","transparent"],"outputFormatEnum":["png","jpeg","webp"],"imagesMaxItems":9,"supportsMask":false,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","5:4","7:6","9:16","21:9","9:21","16:9","3:2","4:3","4:5","3:4","2:3"],"qualityEnum":["medium","low","high","xhigh","max"],"backgroundEnum":["auto","opaque","transparent"],"outputFormatEnum":["png","jpeg","webp","gif"],"imagesMaxItems":16,"supportsMask":false,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":10,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":[],"qualityEnum":["low","medium","high"],"backgroundEnum":["auto","opaque","transparent"],"outputFormatEnum":["png","jpeg"],"imagesMaxItems":16,"supportsMask":true,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":10,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":[],"qualityEnum":["low","medium","high","xhigh","max","auto"],"backgroundEnum":["auto","opaque","transparent"],"outputFormatEnum":["png","jpeg"],"imagesMaxItems":16,"supportsMask":true,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":10,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","1024x1024","3:2","1536x1024","16:9","1536x864","4:3","1536x1152","3:4","1152x1536","5:4","1280x1024","4:5","1024x1280","21:9","1536x656","9:21","656x1536","2:3","1024x1536","auto","9:16"],"qualityEnum":["auto","low","medium","high"],"backgroundEnum":["auto","opaque","transparent"],"outputFormatEnum":["png","jpeg","webp"],"imagesMaxItems":16,"supportsMask":true,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":10,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","1024x1024","3:2","1536x1024","16:9","1536x864","4:3","1536x1152","3:4","1152x1536","5:4","1280x1024","4:5","1024x1280","21:9","1536x656","9:21","656x1536","2:3","1024x1536","auto","9:16"],"qualityEnum":["auto","low","medium","high","xhigh","max"],"backgroundEnum":["auto","opaque","transparent"],"outputFormatEnum":["png","jpeg","webp"],"imagesMaxItems":16,"supportsMask":true,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":10,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","1024x1024","3:2","1536x1024","16:9","1536x864","4:3","1536x1152","3:4","1152x1536","5:4","1280x1024","4:5","1024x1280","21:9","1536x656","9:21","656x1536","2:3","1024x1536","auto","9:16"],"qualityEnum":["auto","low","medium","high","xhigh","max"],"backgroundEnum":["auto","opaque","transparent"],"outputFormatEnum":["png","jpeg","webp","gif","svg"],"imagesMaxItems":16,"supportsMask":true,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","9:16","21:9","16:9","3:2","4:3","3:4","2:3"],"qualityEnum":[],"backgroundEnum":[],"outputFormatEnum":[],"imagesMaxItems":9,"supportsMask":true,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","5:4","4:5","21:9","auto"],"qualityEnum":["1k","2k","4k"],"backgroundEnum":[],"outputFormatEnum":[],"imagesMaxItems":9,"supportsMask":true,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","4:3","3:4","16:9","9:16","3:2","2:3","21:9"],"qualityEnum":[],"backgroundEnum":[],"outputFormatEnum":[],"imagesMaxItems":9,"supportsMask":true,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":10,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","4:1","1:4","8:1","1:8","5:4","4:5","21:9","auto"],"qualityEnum":["1k","2k","4k"],"backgroundEnum":[],"outputFormatEnum":[],"imagesMaxItems":7,"supportsMask":false,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","4:3","3:4","16:9","9:16","3:2","2:3","21:9"],"qualityEnum":[],"backgroundEnum":[],"outputFormatEnum":[],"imagesMaxItems":16,"supportsMask":true,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","5:4","4:5","21:9","8:1","4:1","1:4","1:8","auto"],"qualityEnum":["1k","2k","4k"],"backgroundEnum":[],"outputFormatEnum":[],"imagesMaxItems":9,"supportsMask":true,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","5:4","4:5","21:9","auto"],"qualityEnum":["1k","2k","4k"],"backgroundEnum":[],"outputFormatEnum":[],"imagesMaxItems":14,"supportsMask":false,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","3:2","2:3","4:3","3:4","5:4","4:5","16:9","9:16","21:9","auto"],"qualityEnum":[],"backgroundEnum":[],"outputFormatEnum":[],"imagesMaxItems":5,"supportsMask":false,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","3:2","2:3","4:3","3:4","5:4","4:5","16:9","9:16","21:9","auto"],"qualityEnum":[],"backgroundEnum":[],"outputFormatEnum":[],"imagesMaxItems":2,"supportsMask":false,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":false,"sizeEnum":[],"sizeRecommendations":[],"qualityEnum":[],"backgroundEnum":[],"outputFormatEnum":[],"imagesMaxItems":1,"supportsMask":false,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","16:9","9:16","4:3","3:4","2:3","3:2","21:9","9:21","auto"],"qualityEnum":["1","4"],"backgroundEnum":[],"outputFormatEnum":[],"imagesMaxItems":8,"supportsMask":false,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["16:9","9:16","1:1","21:9","4:3","3:4","auto"],"qualityEnum":[],"backgroundEnum":[],"outputFormatEnum":[],"supportsMask":false,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:2","6:11","9:16","2:3","3:4","4:5","5:6","1:1","2:1","11:6","16:9","3:2","4:3","5:4","6:5"],"qualityEnum":[],"backgroundEnum":[],"outputFormatEnum":[],"imagesMaxItems":4,"supportsMask":true,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1024x1024","1280x720","720x1280","1792x1024","1024x1792","1:1","16:9","9:16","3:2","2:3","4:3","3:4"],"qualityEnum":[],"backgroundEnum":[],"outputFormatEnum":[],"imagesMaxItems":8,"supportsMask":true,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","3:2","2:3","4:3","3:4","16:9","9:16","21:9"],"qualityEnum":[],"backgroundEnum":[],"outputFormatEnum":[],"imagesMaxItems":10,"supportsMask":false,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","4:3","3:4","16:9","9:16","3:2","2:3","21:9"],"qualityEnum":[],"backgroundEnum":[],"outputFormatEnum":[],"imagesMaxItems":10,"supportsMask":false,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["auto","1:1","3:2","2:3","4:3","3:4","16:9","9:16","21:9","9:21"],"qualityEnum":[],"backgroundEnum":[],"outputFormatEnum":[],"imagesMaxItems":10,"supportsMask":false,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1K","1.5K","2K","auto"],"qualityEnum":[],"backgroundEnum":["auto","transparent","opaque"],"outputFormatEnum":["png","jpeg"],"imagesMaxItems":10,"supportsMask":false,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","4:3","3:4","16:9","9:16","3:2","2:3","21:9"],"qualityEnum":["1k","2k"],"backgroundEnum":[],"outputFormatEnum":["jpeg","png"],"imagesMaxItems":10,"supportsMask":false,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","3:2","2:3","4:3","3:4","16:9","9:16","21:9"],"qualityEnum":[],"backgroundEnum":[],"outputFormatEnum":[],"imagesMaxItems":1,"supportsMask":false,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["auto","1:1","2:3","3:2","3:4","4:3","9:16","16:9","21:9"],"qualityEnum":[],"backgroundEnum":[],"outputFormatEnum":[],"imagesMaxItems":14,"supportsMask":false,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["auto","1:1","1:2","1:3","2:1","2:3","3:1","3:2","3:4","4:3","4:5","5:4","9:16","9:21","16:9","21:9"],"qualityEnum":[],"backgroundEnum":[],"outputFormatEnum":["jpeg","png"],"imagesMaxItems":10,"supportsMask":false,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["auto","1:1","1:2","1:3","2:1","2:3","3:1","3:2","3:4","4:3","4:5","5:4","9:16","9:21","16:9","21:9"],"qualityEnum":[],"backgroundEnum":["auto","transparent","opaque"],"outputFormatEnum":["png","jpeg"],"imagesMaxItems":10,"supportsMask":false,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","4:3","3:4","16:9","9:16"],"qualityEnum":[],"backgroundEnum":[],"outputFormatEnum":[],"supportsMask":false,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","1024x1024","3:2","1536x1024","2:3","1024x1536","16:9","1920x1080","9:16","1080x1920","1:1-max","1920x1920","auto"],"qualityEnum":[],"backgroundEnum":[],"outputFormatEnum":["png","jpeg","webp"],"imagesMaxItems":16,"supportsMask":true,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["auto","21:9","2:1","16:9","3:2","7:5","4:3","5:4","1:1","4:5","3:4","5:7","2:3","9:16","1:2","9:21"],"qualityEnum":[],"backgroundEnum":[],"outputFormatEnum":[],"imagesMaxItems":10,"supportsMask":false,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","16:9","9:16","4:3","3:4","3:2","2:3","21:9","9:21","auto"],"qualityEnum":[],"backgroundEnum":[],"outputFormatEnum":["png","jpeg","webp"],"imagesMaxItems":10,"supportsMask":false,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
  {"nMax":1,"supportsSize":true,"sizeEnum":[],"sizeRecommendations":["1:1","16:9","9:16","4:3","3:4","3:2","2:3"],"qualityEnum":[],"backgroundEnum":[],"outputFormatEnum":["png","jpeg","webp"],"imagesMaxItems":4,"supportsMask":false,"supportsAspectRatio":false,"aspectRatioEnum":[],"aspectRatioRecommendations":[]},
];

const PROFILE_INDEX_BY_PUBLIC_MODEL: Readonly<Record<string, number>> = Object.freeze(
{
    "ax-gpt-image-2": 0,
    "ax-gpt-image-2.5-flare": 1,
    "ax-gpt-image-2.5-sunburst": 1,
    "ax-gpt-image-2.6-flare": 2,
    "ax-gpt-image-2.6-sunburst": 2,
    "gpt-image-2": 3,
    "gpt-image-2-1k": 4,
    "gpt-image-2-2k": 5,
    "gpt-image-2-4k": 4,
    "gpt-image-2-x": 6,
    "gpt-image-2.5": 3,
    "gpt-image-2.5-flare": 3,
    "gpt-image-2.5-flare-1k": 7,
    "gpt-image-2.5-flare-2k": 7,
    "gpt-image-2.5-flare-4k": 7,
    "gpt-image-2.5-sunburst": 3,
    "gpt-image-2.5-sunburst-1k": 7,
    "gpt-image-2.5-sunburst-2k": 7,
    "gpt-image-2.5-sunburst-4k": 7,
    "gpt-image-2.5-x": 6,
    "gpt-image-2.6": 8,
    "gpt-image-2.6-flare": 9,
    "gpt-image-2.6-flare-1k": 10,
    "gpt-image-2.6-flare-2k": 10,
    "gpt-image-2.6-flare-4k": 10,
    "gpt-image-2.6-sunburst": 9,
    "gpt-image-2.6-sunburst-1k": 10,
    "gpt-image-2.6-sunburst-2k": 10,
    "gpt-image-2.6-sunburst-4k": 10,
    "gpt-image-2.6-x": 6,
    "gpt-image-2-az": 11,
    "gpt-image-2.5-flare-az": 12,
    "gpt-image-2.5-sunburst-az": 12,
    "gpt-image-2-o": 13,
    "gpt-image-2.5-flare-o": 14,
    "gpt-image-2.5-sunburst-o": 14,
    "gpt-image-2.6-flare-o": 15,
    "gpt-image-2.6-sunburst-o": 15,
    "nano-banana-pro-1k": 16,
    "nano-banana-pro-2k": 16,
    "nano-banana-pro-4k": 16,
    "gemini-3-pro-image-preview": 17,
    "nano-banana2-1k": 18,
    "nano-banana2.1": 19,
    "nano-banana2-2k": 18,
    "nano-banana2-4k": 20,
    "gemini-3.1-flash-image-preview": 21,
    "gemini-nano-banana-2.1": 22,
    "mj2-midjourney": 23,
    "mj2-midjourney-blend": 24,
    "mj2-midjourney-describe": 25,
    "Midjourney-v8.1": 26,
    "Midjourney-v8.2": 26,
    "midjourney": 27,
    "midjourney-1k": 28,
    "midjourney-2k": 28,
    "grok-imagine-image": 29,
    "grok-imagine-image-2.0": 29,
    "doubao-seedream-5-0-flash": 30,
    "seedream-5.0-pro-x": 31,
    "doubao-seedream-5-5": 32,
    "doubao-seedream-5-5-261028": 33,
    "doubao-seedream-5-0-pro": 34,
    "doubao-seedream-5-0-lite": 35,
    "doubao-seedream-5-0-lite-x": 36,
    "doubao-seedream-5-0-pro-x": 37,
    "doubao-seedream-5-5-x": 38,
    "Z-Image-Turbo": 39,
    "flux-pro-2": 40,
    "flux-3-image": 41,
    "flux-3-klein": 42,
    "mu1-muse-image": 43
  }
);

export const CANGYUAN_IMAGE_PUBLIC_MODEL_NAMES: readonly string[] = Object.freeze(
  Object.keys(PROFILE_INDEX_BY_PUBLIC_MODEL),
);

export function getCangyuanImageModelProfile(
  rawPublicModelName: string,
): CangyuanImageModelProfile | null {
  if (!Object.hasOwn(PROFILE_INDEX_BY_PUBLIC_MODEL, rawPublicModelName)) return null;
  const profileIndex = PROFILE_INDEX_BY_PUBLIC_MODEL[rawPublicModelName];
  const profile = PROFILE_SETS[profileIndex];
  if (!profile) return null;

  return {
    publicModel: rawPublicModelName,
    ...profile,
    sizeEnum: [...profile.sizeEnum],
    sizeRecommendations: [...profile.sizeRecommendations],
    aspectRatioEnum: [...profile.aspectRatioEnum],
    aspectRatioRecommendations: [...profile.aspectRatioRecommendations],
    qualityEnum: [...profile.qualityEnum],
    backgroundEnum: [...profile.backgroundEnum],
    outputFormatEnum: [...profile.outputFormatEnum],
  };
}
