export type UserListSearchBy = 'all' | 'email' | 'name' | 'username';
export type UserListStatus = 'all' | 'verified' | 'unverified';
export type UserListSortBy = 'joined' | 'name';
export type UserListSortOrder = 'asc' | 'desc';

export type ListUsersQuery = {
  role?: string;
  search?: string;
  searchBy?: UserListSearchBy;
  status?: UserListStatus;
  sortBy?: UserListSortBy;
  sortOrder?: UserListSortOrder;
};

export function normalizeListUsersQuery(input: {
  search?: string | null;
  searchBy?: string | null;
  status?: string | null;
  sortBy?: string | null;
  sortOrder?: string | null;
}): Omit<ListUsersQuery, 'role'> {
  const searchByRaw = input.searchBy?.trim().toLowerCase();
  const searchBy: UserListSearchBy =
    searchByRaw === 'email' ||
    searchByRaw === 'name' ||
    searchByRaw === 'username'
      ? searchByRaw
      : 'all';

  const statusRaw = input.status?.trim().toLowerCase();
  const status: UserListStatus =
    statusRaw === 'verified' || statusRaw === 'unverified'
      ? statusRaw
      : 'all';

  const sortByRaw = input.sortBy?.trim().toLowerCase();
  const sortBy: UserListSortBy = sortByRaw === 'name' ? 'name' : 'joined';

  const sortOrder: UserListSortOrder =
    input.sortOrder?.trim().toLowerCase() === 'asc' ? 'asc' : 'desc';

  return {
    search: input.search?.trim() || undefined,
    searchBy,
    status,
    sortBy,
    sortOrder,
  };
}
