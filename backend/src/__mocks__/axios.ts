const axios = {
  create: () => axios,
  get: jest.fn(async () => ({ data: {} })),
  post: jest.fn(async () => ({ data: {} })),
  put: jest.fn(async () => ({ data: {} })),
  patch: jest.fn(async () => ({ data: {} })),
  delete: jest.fn(async () => ({ data: {} })),
};

export default axios;
