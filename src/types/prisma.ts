type PrismaQueryEvent = {
  query: string;
  params: string;
  duration: number;
};

type PrismaLogEvent = {
  message: string;
};

export {
  PrismaQueryEvent, PrismaLogEvent
}