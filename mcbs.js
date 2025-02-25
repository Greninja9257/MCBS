/**
 * MCBS - Minecraft Bot Script
 * A comprehensive Minecraft bot API built on top of node-minecraft-protocol
 * 
 * Features:
 * - Easy bot creation and management
 * - Movement, combat, and inventory control
 * - Block interaction and world navigation
 * - Chat and command handling
 * - Entity and player tracking
 * - Crafting and smelting automation
 * - Customizable event system
 */

// Core dependencies
const mc = require('minecraft-protocol');
const vec3 = require('vec3');
const pathfinder = require('./pathfinder');
const EventEmitter = require('events').EventEmitter;

class MinecraftBot extends EventEmitter {
  /**
   * Create a new Minecraft bot
   * @param {Object} options - Connection options
   * @param {string} options.host - Server hostname
   * @param {number} options.port - Server port (default: 25565)
   * @param {string} options.username - Bot username
   * @param {string} options.password - Account password (for premium accounts)
   * @param {string} options.version - Minecraft version (default: '1.20.4')
   * @param {boolean} options.auth - Authentication type ('mojang' or 'microsoft', default: 'microsoft')
   */
  constructor(options) {
    super();
    
    this.options = Object.assign({
      port: 25565,
      version: '1.20.4',
      auth: 'microsoft'
    }, options);

    this.username = options.username;
    this.connected = false;
    this.position = vec3(0, 0, 0);
    this.velocity = vec3(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.health = 20;
    this.food = 20;
    this.gameMode = 0;
    
    this.inventory = new Inventory(this);
    this.world = new World(this);
    this.entities = new EntityTracker(this);
    this.physics = new Physics(this);
    this.crafting = new Crafting(this);
    this.combat = new Combat(this);
    this.pathfinder = new pathfinder.Pathfinder(this);
    
    this._setupClient();
  }

  /**
   * Set up the Minecraft protocol client
   * @private
   */
  _setupClient() {
    this.client = mc.createClient(this.options);
    
    this.client.on('connect', () => {
      this.connected = true;
      this.emit('connect');
    });
    
    this.client.on('disconnect', (reason) => {
      this.connected = false;
      this.emit('disconnect', reason);
    });
    
    this.client.on('error', (err) => {
      this.emit('error', err);
    });
    
    // Set up packet handlers
    this._registerPacketHandlers();
  }

  /**
   * Register handlers for various packets
   * @private
   */
  _registerPacketHandlers() {
    // Position updates
    this.client.on('position', (packet) => {
      this.position.set(packet.x, packet.y, packet.z);
      this.yaw = packet.yaw;
      this.pitch = packet.pitch;
      this.onGround = packet.onGround;
      this.emit('position', this.position);
    });
    
    // Chat messages
    this.client.on('chat', (packet) => {
      const message = packet.message;
      this.emit('chat', message, packet.sender);
    });
    
    // Entity updates
    this.client.on('entity_metadata', (packet) => {
      this.entities.updateMetadata(packet.entityId, packet.metadata);
    });
    
    // Health updates
    this.client.on('health', (packet) => {
      this.health = packet.health;
      this.food = packet.food;
      this.foodSaturation = packet.foodSaturation;
      this.emit('health', this.health, this.food);
      
      if (this.health <= 0) {
        this.emit('death');
      }
    });
    
    // Block updates
    this.client.on('block_change', (packet) => {
      const pos = vec3(packet.location.x, packet.location.y, packet.location.z);
      const block = packet.type;
      this.world.setBlock(pos, block);
      this.emit('blockUpdate', pos, block);
    });
  }

  /**
   * Send a chat message to the server
   * @param {string} message - Message content
   */
  chat(message) {
    this.client.write('chat', { message });
  }

  /**
   * Move to specified coordinates
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {number} z - Z coordinate
   * @param {Object} options - Movement options
   * @param {boolean} options.sprint - Whether to sprint
   * @param {boolean} options.jump - Whether to jump over obstacles
   * @returns {Promise} - Resolves when destination is reached
   */
  async moveTo(x, y, z, options = {}) {
    const target = vec3(x, y, z);
    return this.pathfinder.goto(target, options);
  }

  /**
   * Look at a specific position
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {number} z - Z coordinate
   */
  lookAt(x, y, z) {
    const target = vec3(x, y, z);
    const delta = target.minus(this.position);
    
    this.yaw = Math.atan2(-delta.x, -delta.z);
    const groundDistance = Math.sqrt(delta.x * delta.x + delta.z * delta.z);
    this.pitch = Math.atan2(delta.y, groundDistance);
    
    this.client.write('look', {
      yaw: this.yaw,
      pitch: this.pitch,
      onGround: this.onGround
    });
  }

  /**
   * Attack an entity
   * @param {number} entityId - ID of the entity to attack
   */
  attack(entityId) {
    this.client.write('use_entity', {
      target: entityId,
      action: 1, // 1 = attack
      hand: 0    // 0 = main hand
    });
  }

  /**
   * Place a block
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {number} z - Z coordinate
   * @param {number} face - Block face (0-5)
   */
  placeBlock(x, y, z, face) {
    const position = { x, y, z };
    this.client.write('block_place', {
      location: position,
      direction: face,
      hand: 0, // 0 = main hand
      cursorX: 0.5,
      cursorY: 0.5,
      cursorZ: 0.5
    });
  }

  /**
   * Mine a block
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {number} z - Z coordinate
   * @returns {Promise} - Resolves when block is broken
   */
  async mineBlock(x, y, z) {
    const position = { x, y, z };
    
    // Start digging
    this.client.write('block_dig', {
      status: 0, // 0 = start digging
      location: position,
      face: 1    // 1 = top face
    });
    
    // Wait for block to break
    await new Promise(resolve => {
      const onBlockBreak = (pos) => {
        if (pos.x === x && pos.y === y && pos.z === z) {
          this.removeListener('blockUpdate', onBlockBreak);
          resolve();
        }
      };
      
      this.on('blockUpdate', onBlockBreak);
      
      // Finish digging after calculated time
      setTimeout(() => {
        this.client.write('block_dig', {
          status: 2, // 2 = finish digging
          location: position,
          face: 1    // 1 = top face
        });
      }, this.world.getDigTime(position));
    });
  }

  /**
   * Disconnect from the server
   * @param {string} reason - Reason for disconnection
   */
  disconnect(reason = 'disconnect') {
    if (this.connected) {
      this.client.end(reason);
    }
  }
}

class Inventory {
  /**
   * Inventory management system
   * @param {MinecraftBot} bot - Bot instance
   */
  constructor(bot) {
    this.bot = bot;
    this.slots = new Array(46).fill(null);
    this.selectedSlot = 0;
    
    // Listen for inventory updates
    bot.client.on('window_items', (packet) => {
      this.slots = packet.items;
    });
    
    bot.client.on('set_slot', (packet) => {
      this.slots[packet.slot] = packet.item;
    });
  }

  /**
   * Find an item in the inventory
   * @param {string|number} itemName - Item name or ID
   * @returns {Object} Item data and slot
   */
  findItem(itemName) {
    for (let i = 0; i < this.slots.length; i++) {
      const item = this.slots[i];
      if (item && (item.name === itemName || item.id === itemName)) {
        return { item, slot: i };
      }
    }
    return null;
  }

  /**
   * Select a hotbar slot
   * @param {number} slot - Slot number (0-8)
   */
  selectSlot(slot) {
    if (slot < 0 || slot > 8) {
      throw new Error('Hotbar slots must be between 0 and 8');
    }
    
    this.selectedSlot = slot;
    this.bot.client.write('held_item_slot', { slot });
  }

  /**
   * Move an item to a different slot
   * @param {number} fromSlot - Source slot
   * @param {number} toSlot - Destination slot
   */
  moveItem(fromSlot, toSlot) {
    // First click source slot
    this.bot.client.write('window_click', {
      windowId: 0,
      slot: fromSlot,
      button: 0,
      action: 0,
      mode: 0,
      item: this.slots[fromSlot]
    });
    
    // Then click destination slot
    this.bot.client.write('window_click', {
      windowId: 0,
      slot: toSlot,
      button: 0,
      action: 0,
      mode: 0,
      item: this.slots[fromSlot]
    });
  }

  /**
   * Drop an item
   * @param {number} slot - Slot to drop from
   * @param {boolean} fullStack - Whether to drop entire stack
   */
  dropItem(slot, fullStack = false) {
    this.bot.client.write('window_click', {
      windowId: 0,
      slot,
      button: fullStack ? 1 : 0,
      action: 4, // 4 = drop
      mode: 4,   // 4 = drop mode
      item: this.slots[slot]
    });
  }
}

class World {
  /**
   * World and block interaction system
   * @param {MinecraftBot} bot - Bot instance
   */
  constructor(bot) {
    this.bot = bot;
    this.blocks = new Map();
    this.chunkLoaded = new Set();
    
    // Listen for chunk data
    bot.client.on('map_chunk', (packet) => {
      const chunkX = packet.x;
      const chunkZ = packet.z;
      this.chunkLoaded.add(`${chunkX},${chunkZ}`);
      this._processChunkData(packet);
    });
  }

  /**
   * Process incoming chunk data
   * @param {Object} packet - Chunk data packet
   * @private
   */
  _processChunkData(packet) {
    // Process block data from chunk
    // This is simplified; actual implementation would parse the chunk data format
  }

  /**
   * Set a block in the world
   * @param {Vec3} position - Block position
   * @param {number} blockType - Block type ID
   */
  setBlock(position, blockType) {
    const key = `${position.x},${position.y},${position.z}`;
    this.blocks.set(key, blockType);
  }

  /**
   * Get a block from the world
   * @param {Vec3} position - Block position
   * @returns {number} Block type ID
   */
  getBlock(position) {
    const key = `${position.x},${position.y},${position.z}`;
    return this.blocks.get(key) || 0;
  }

  /**
   * Calculate time needed to break a block
   * @param {Object} position - Block position
   * @returns {number} Time in milliseconds
   */
  getDigTime(position) {
    const block = this.getBlock(position);
    // This is simplified; actual implementation would consider block hardness,
    // tool efficiency, and enchantments
    return 1000; // Default 1 second
  }

  /**
   * Check if a position is walkable
   * @param {Vec3} position - Position to check
   * @returns {boolean} Whether position is walkable
   */
  isWalkable(position) {
    const block = this.getBlock(position);
    const blockAbove = this.getBlock(position.offset(0, 1, 0));
    const blockBelow = this.getBlock(position.offset(0, -1, 0));
    
    // Simplified walkability check
    return block === 0 && blockAbove === 0 && blockBelow !== 0;
  }
}

class EntityTracker {
  /**
   * Entity tracking system
   * @param {MinecraftBot} bot - Bot instance
   */
  constructor(bot) {
    this.bot = bot;
    this.entities = new Map();
    this.players = new Map();
    
    // Listen for entity spawns
    bot.client.on('spawn_entity', (packet) => {
      this.entities.set(packet.entityId, {
        id: packet.entityId,
        type: packet.type,
        position: vec3(packet.x, packet.y, packet.z),
        velocity: vec3(packet.velocityX, packet.velocityY, packet.velocityZ),
        yaw: packet.yaw,
        pitch: packet.pitch
      });
    });
    
    // Listen for player spawns
    bot.client.on('spawn_player', (packet) => {
      this.players.set(packet.entityId, {
        id: packet.entityId,
        uuid: packet.uuid,
        name: packet.name,
        position: vec3(packet.x, packet.y, packet.z),
        yaw: packet.yaw,
        pitch: packet.pitch
      });
      
      this.entities.set(packet.entityId, this.players.get(packet.entityId));
    });
    
    // Listen for entity destruction
    bot.client.on('entity_destroy', (packet) => {
      for (const entityId of packet.entityIds) {
        this.entities.delete(entityId);
        this.players.delete(entityId);
      }
    });
    
    // Listen for entity movement
    bot.client.on('entity_move', (packet) => {
      const entity = this.entities.get(packet.entityId);
      if (entity) {
        entity.position.add(
          packet.dX / 32,
          packet.dY / 32,
          packet.dZ / 32
        );
      }
    });
  }

  /**
   * Update entity metadata
   * @param {number} entityId - Entity ID
   * @param {Array} metadata - Entity metadata
   */
  updateMetadata(entityId, metadata) {
    const entity = this.entities.get(entityId);
    if (entity) {
      entity.metadata = metadata;
    }
  }

  /**
   * Find the nearest entity by type
   * @param {string|Array} type - Entity type or array of types
   * @param {number} maxDistance - Maximum search distance
   * @returns {Object} Nearest entity
   */
  findNearestEntity(type, maxDistance = Infinity) {
    let nearestEntity = null;
    let nearestDistance = maxDistance;
    
    const types = Array.isArray(type) ? type : [type];
    
    for (const entity of this.entities.values()) {
      if (!types.includes(entity.type)) continue;
      
      const distance = entity.position.distanceTo(this.bot.position);
      if (distance < nearestDistance) {
        nearestEntity = entity;
        nearestDistance = distance;
      }
    }
    
    return nearestEntity;
  }

  /**
   * Find the nearest player
   * @param {number} maxDistance - Maximum search distance
   * @returns {Object} Nearest player
   */
  findNearestPlayer(maxDistance = Infinity) {
    let nearestPlayer = null;
    let nearestDistance = maxDistance;
    
    for (const player of this.players.values()) {
      const distance = player.position.distanceTo(this.bot.position);
      if (distance < nearestDistance) {
        nearestPlayer = player;
        nearestDistance = distance;
      }
    }
    
    return nearestPlayer;
  }
}

class Physics {
  /**
   * Physics and movement system
   * @param {MinecraftBot} bot - Bot instance
   */
  constructor(bot) {
    this.bot = bot;
    this.gravity = -0.08;
    this.jumpSpeed = 0.42;
    this.jumpCooldown = 0;
    
    // Update physics regularly
    setInterval(() => this._update(), 50); // 20 ticks per second
  }

  /**
   * Update physics simulation
   * @private
   */
  _update() {
    if (!this.bot.connected) return;
    
    // Apply gravity
    if (!this._isOnGround()) {
      this.bot.velocity.y += this.gravity;
    } else if (this.bot.velocity.y < 0) {
      this.bot.velocity.y = 0;
    }
    
    // Update position based on velocity
    this.bot.position.add(this.bot.velocity);
    
    // Update jump cooldown
    if (this.jumpCooldown > 0) {
      this.jumpCooldown--;
    }
    
    // Send position update to server
    this._sendPositionUpdate();
  }

  /**
   * Send position update to server
   * @private
   */
  _sendPositionUpdate() {
    this.bot.client.write('position', {
      x: this.bot.position.x,
      y: this.bot.position.y,
      z: this.bot.position.z,
      onGround: this._isOnGround()
    });
  }

  /**
   * Check if bot is on ground
   * @returns {boolean} Whether bot is on ground
   * @private
   */
  _isOnGround() {
    // Check if there's a block below
    const blockBelow = this.bot.world.getBlock(
      this.bot.position.offset(0, -0.1, 0)
    );
    
    return blockBelow !== 0;
  }

  /**
   * Jump
   */
  jump() {
    if (this._isOnGround() && this.jumpCooldown === 0) {
      this.bot.velocity.y = this.jumpSpeed;
      this.jumpCooldown = 10; // Half-second cooldown
    }
  }

  /**
   * Move in a direction
   * @param {number} x - X direction
   * @param {number} z - Z direction
   * @param {boolean} sprint - Whether to sprint
   */
  move(x, z, sprint = false) {
    const speed = sprint ? 0.13 : 0.1;
    
    // Calculate movement vector based on yaw
    const yaw = this.bot.yaw;
    this.bot.velocity.x = (x * Math.sin(yaw) - z * Math.cos(yaw)) * speed;
    this.bot.velocity.z = (z * Math.sin(yaw) + x * Math.cos(yaw)) * speed;
  }
}

class Crafting {
  /**
   * Crafting system
   * @param {MinecraftBot} bot - Bot instance
   */
  constructor(bot) {
    this.bot = bot;
    this.recipes = new Map();
    this.craftingTablePos = null;
    
    // Load recipes (simplified for this example)
    this._loadRecipes();
  }

  /**
   * Load crafting recipes
   * @private
   */
  _loadRecipes() {
    // This would normally load from Minecraft data
    // Simplified example recipe
    this.recipes.set('stick', {
      ingredients: [{ item: 'planks', count: 2 }],
      result: { item: 'stick', count: 4 },
      requiresCraftingTable: false
    });
  }

  /**
   * Craft an item
   * @param {string} itemName - Item to craft
   * @param {number} count - Number of items to craft
   * @returns {Promise} - Resolves when crafting is complete
   */
  async craft(itemName, count = 1) {
    const recipe = this.recipes.get(itemName);
    if (!recipe) {
      throw new Error(`Unknown recipe: ${itemName}`);
    }
    
    if (recipe.requiresCraftingTable && !this.craftingTablePos) {
      throw new Error('Crafting table required but not found');
    }
    
    // Check if we have the ingredients
    for (const ingredient of recipe.ingredients) {
      const found = this.bot.inventory.findItem(ingredient.item);
      if (!found || found.item.count < ingredient.count * count) {
        throw new Error(`Missing ingredient: ${ingredient.item}`);
      }
    }
    
    // Open crafting table if needed
    if (recipe.requiresCraftingTable) {
      await this._openCraftingTable();
    }
    
    // Place ingredients (simplified)
    for (let i = 0; i < recipe.ingredients.length; i++) {
      const ingredient = recipe.ingredients[i];
      const found = this.bot.inventory.findItem(ingredient.item);
      
      this.bot.client.write('window_click', {
        windowId: recipe.requiresCraftingTable ? 1 : 0,
        slot: found.slot,
        button: 0,
        action: i,
        mode: 0,
        item: found.item
      });
    }
    
    // Click result
    this.bot.client.write('window_click', {
      windowId: recipe.requiresCraftingTable ? 1 : 0,
      slot: 0,
      button: 0,
      action: recipe.ingredients.length,
      mode: 0,
      item: null
    });
    
    // Close crafting table if needed
    if (recipe.requiresCraftingTable) {
      this.bot.client.write('close_window', { windowId: 1 });
    }
  }

  /**
   * Open a crafting table
   * @returns {Promise} - Resolves when crafting table is opened
   * @private
   */
  async _openCraftingTable() {
    if (!this.craftingTablePos) {
      throw new Error('No crafting table position set');
    }
    
    // Move to crafting table if needed
    const distance = this.bot.position.distanceTo(this.craftingTablePos);
    if (distance > 3) {
      await this.bot.moveTo(
        this.craftingTablePos.x,
        this.craftingTablePos.y,
        this.craftingTablePos.z
      );
    }
    
    // Right-click the crafting table
    this.bot.client.write('block_place', {
      location: {
        x: this.craftingTablePos.x,
        y: this.craftingTablePos.y,
        z: this.craftingTablePos.z
      },
      direction: 1,
      hand: 0,
      cursorX: 0.5,
      cursorY: 0.5,
      cursorZ: 0.5
    });
    
    // Wait for window to open
    return new Promise(resolve => {
      const onWindowOpen = (packet) => {
        if (packet.windowType === 'crafting_table') {
          this.bot.removeListener('window_open', onWindowOpen);
          resolve();
        }
      };
      
      this.bot.on('window_open', onWindowOpen);
    });
  }

  /**
   * Set the position of a crafting table
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {number} z - Z coordinate
   */
  setCraftingTablePosition(x, y, z) {
    this.craftingTablePos = vec3(x, y, z);
  }
}

class Combat {
  /**
   * Combat system
   * @param {MinecraftBot} bot - Bot instance
   */
  constructor(bot) {
    this.bot = bot;
    this.target = null;
    this.attackCooldown = 0;
    
    // Update combat regularly
    setInterval(() => this._update(), 50); // 20 ticks per second
  }

  /**
   * Update combat logic
   * @private
   */
  _update() {
    if (!this.bot.connected || !this.target) return;
    
    // Check if target still exists
    const entity = this.bot.entities.entities.get(this.target.id);
    if (!entity) {
      this.target = null;
      return;
    }
    
    // Move towards target if too far
    const distance = entity.position.distanceTo(this.bot.position);
    if (distance > 3) {
      this.bot.physics.move(0, 1, true); // Move forward at sprint speed
      this.bot.lookAt(entity.position.x, entity.position.y + 1, entity.position.z);
    } else {
      // Attack if close enough and cooldown expired
      if (this.attackCooldown === 0) {
        this.bot.attack(this.target.id);
        this.attackCooldown = 10; // Half-second cooldown
      } else {
        this.attackCooldown--;
      }
    }
  }

  /**
   * Attack a specific entity
   * @param {Object} entity - Entity to attack
   */
  attackEntity(entity) {
    this.target = entity;
    this.bot.lookAt(entity.position.x, entity.position.y + 1, entity.position.z);
    this.bot.attack(entity.id);
  }

  /**
   * Attack the nearest entity of a given type
   * @param {string|Array} type - Entity type or array of types
   * @param {number} maxDistance - Maximum search distance
   */
  attackNearestEntity(type, maxDistance = 16) {
    const entity = this.bot.entities.findNearestEntity(type, maxDistance);
    if (entity) {
      this.attackEntity(entity);
    }
  }

  /**
   * Stop attacking
   */
  stop() {
    this.target = null;
  }
}

// Export the main classes
module.exports = {
  createBot: (options) => new MinecraftBot(options),
  MinecraftBot,
  vec3
};