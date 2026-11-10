/** The categories offered to the deals searches of the portal. */
export // Search indexes found on most marketplaces; "All" searches every category
const CATEGORIES: { id: string; label: string }[] = [
  { id: 'All', label: 'Every category' }, { id: 'Electronics', label: 'Electronics' }, { id: 'Computers', label: 'Computers' },
  { id: 'VideoGames', label: 'Video games' }, { id: 'HomeAndKitchen', label: 'Home and kitchen' },
  { id: 'ToolsAndHomeImprovement', label: 'Tools and DIY' }, { id: 'GardenAndOutdoor', label: 'Garden' },
  { id: 'SportsAndOutdoors', label: 'Sports and outdoors' }, { id: 'ToysAndGames', label: 'Toys and games' },
  { id: 'Books', label: 'Books' }, { id: 'Beauty', label: 'Beauty' }, { id: 'HealthPersonalCare', label: 'Health' },
  { id: 'Baby', label: 'Baby' }, { id: 'PetSupplies', label: 'Pet supplies' }, { id: 'OfficeProducts', label: 'Office' },
  { id: 'MusicalInstruments', label: 'Musical instruments' }, { id: 'Automotive', label: 'Automotive' }, { id: 'Fashion', label: 'Fashion' }
];

// Same limits as the server
export const MAX_SEARCHES = 5;
export const MAX_PRODUCTS = 10;
