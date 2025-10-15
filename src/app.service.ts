import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class AppService {
  constructor(private readonly dataSource: DataSource) { }

  async createTableFromSchema(schema: any) {
    // 1️⃣ Determine table name
    let tableName = '';
    if (schema.type === 'content-type') {
      tableName = schema.collectionName;
    } else if (schema.type === 'component') {
      tableName = `component_${schema.collectionName}`;
    } else {
      throw new Error(`Unknown schema type: ${schema.type}`);
    }

    // 2️⃣ Prepare columns
    const columns: string[] = ['id SERIAL PRIMARY KEY'];

    for (const [attrName, attr] of Object.entries<any>(schema.attributes)) {
      let type = 'TEXT';

      switch (attr.type) {
        case 'string':
          type = 'TEXT';
          break;
        case 'number':
          type = 'INT';
          break;
        case 'boolean':
          type = 'BOOLEAN';
          break;
        case 'array':
        case 'object':
          type = 'JSONB';
          break;
        case 'component':
          // Skip component columns, handled in separate table
          continue;
        default:
          type = 'TEXT';
      }

      const required = attr.required ? 'NOT NULL' : '';
      columns.push(`"${attrName}" ${type} ${required}`);
    }

    // 3️⃣ Create table
    const createQuery = `CREATE TABLE IF NOT EXISTS "${tableName}" (${columns.join(
      ', ',
    )});`;

    await this.dataSource.query(createQuery);
    console.log(`✅ Table '${tableName}' created successfully`);

    // 4️⃣ Create schema metadata table if not exists
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS "schemas" (
        id SERIAL PRIMARY KEY,
        collection_name TEXT UNIQUE NOT NULL,
        schema JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // 5️⃣ Store schema JSON
    await this.dataSource.query(
      `
      INSERT INTO "schemas" (collection_name, schema)
      VALUES ($1, $2)
      ON CONFLICT (collection_name)
      DO UPDATE SET schema = EXCLUDED.schema, updated_at = NOW()
      `,
      [schema.collectionName, JSON.stringify(schema)],
    );

    console.log(`✅ Schema for '${schema.collectionName}' stored successfully`);
  }

  async updateContentType(schema: any) {
    const tableName =
      schema.type === 'content-type'
        ? schema.collectionName
        : `component_${schema.collectionName}`;

    // 1️⃣ Update main table columns (skip components, dynamic zones & relations)
    for (const [attrName, attr] of Object.entries<any>(schema.attributes)) {
      if (['component', 'relation'].includes(attr.type) || attrName === 'dynamicZone') continue;
      await this.addOrUpdateColumn(tableName, attrName, attr);
    }

    // 2️⃣ Handle top-level components
    const components: Record<string, string> = {};
    for (const [attrName, attr] of Object.entries<any>(schema.attributes)) {
      if (attr.type !== 'component') continue;

      const safeComponentName = attr.component.replace(/[-\s]/g, '_');
      const componentTableName = `component_${safeComponentName}`;
      const relationTable = `${tableName}_components`;

      components[attrName] = relationTable;

      // Create component table
      await this.createComponentTable(safeComponentName, attr);

      // Create junction table (if not exists) with 'field' column
      await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS "${relationTable}" (
        id SERIAL PRIMARY KEY,
        entity_id INT REFERENCES "${tableName}"(id) ON DELETE CASCADE,
        component_id INT REFERENCES "${componentTableName}"(id) ON DELETE CASCADE,
        component_type TEXT NOT NULL,
        field TEXT NOT NULL
      );
    `);

      console.log(`✅ Junction table '${relationTable}' created for component '${attr.component}' (field: '${attrName}')`);
    }

    // 3️⃣ Handle dynamic zones separately
    const dynamicZones: Record<string, string> = {};
    if (Array.isArray(schema.attributes.dynamicZone)) {
      for (const dzItem of schema.attributes.dynamicZone) {
        const dzKey = Object.keys(dzItem)[0];
        const dzAttr = dzItem[dzKey];
        const safeComponentName = dzAttr.component.replace(/[-\s]/g, '_');
        const componentTableName = `component_${safeComponentName}`;
        const relationTable = `${tableName}_components`;

        dynamicZones[dzKey] = relationTable;

        // Create component table for dynamic zone component
        await this.createComponentTable(safeComponentName, dzAttr);

        // Create junction table if not exists
        await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS "${relationTable}" (
          id SERIAL PRIMARY KEY,
          entity_id INT REFERENCES "${tableName}"(id) ON DELETE CASCADE,
          component_id INT REFERENCES "${componentTableName}"(id) ON DELETE CASCADE,
          component_type TEXT NOT NULL,
          field TEXT NOT NULL
        );
      `);

        console.log(`✅ Dynamic zone component '${dzKey}' table/junction created`);
      }
    }

    // 4️⃣ Handle relations
    const relations: Record<string, { junction: string; target: string }> = {};
    for (const [attrName, attr] of Object.entries<any>(schema.attributes)) {
      if (attr.type !== 'relation') continue;

      const relationTable = `${tableName}_${attrName}_link`;
      relations[attrName] = { junction: relationTable, target: attr.target };

      await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS "${relationTable}" (
        id SERIAL PRIMARY KEY,
        entity_id INT REFERENCES "${tableName}"(id) ON DELETE CASCADE,
        ${attrName}_id INT REFERENCES "${attr.target}"(id) ON DELETE CASCADE
      );
    `);
    }

    // 5️⃣ Construct metadata JSON
    const metadata = {
      collectionName: schema.collectionName,
      mainTable: tableName,
      components,       // top-level components
      dynamicZones,     // dynamic zones
      relations,
      schema,           // original schema
    };

    // 6️⃣ Upsert into schemas table
    await this.dataSource.query(
      `
    INSERT INTO "schemas" (collection_name, schema)
    VALUES ($1, $2)
    ON CONFLICT (collection_name)
    DO UPDATE SET schema = $2, updated_at = NOW();
    `,
      [schema.collectionName, JSON.stringify(metadata)]
    );

    console.log(`✅ Schema and metadata updated for '${schema.collectionName}'`);
  }


  // Generate JSON file for table metadata
  generateMetadataJSON(
    collectionName: string,
    mainTable: string,
    components: Record<string, string>,
    relations: Record<string, string>,
    schema: any,
  ) {
    const metadata = {
      collectionName,
      mainTable,
      components,
      relations,
      schema,
    };

    const filePath = path.join(
      process.cwd(),
      'src/schema',
      `${collectionName}.metadata.json`,
    );
    fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2));

    console.log(`✅ Metadata JSON created at: ${filePath}`);
  }

  async createComponentTable(componentName: string, schema: any) {
    // Normalize component name: replace '-' and spaces with '_'
    const safeComponentName = componentName.replace(/[-\s]/g, '_');

    // Use naming convention component_<collectionName>
    const componentTableName = `component_${safeComponentName}`;

    // Base columns
    const columns = ['id SERIAL PRIMARY KEY'];

    for (const [attrName, attr] of Object.entries<any>(
      schema.attributes ?? {},
    )) {
      let type = 'TEXT';
      switch (attr.type) {
        case 'number':
          type = 'INT';
          break;
        case 'boolean':
          type = 'BOOLEAN';
          break;
        case 'array':
        case 'object':
          type = 'JSONB';
          break;
      }
      const required = attr.required ? 'NOT NULL' : '';
      columns.push(`"${attrName}" ${type} ${required}`);
    }

    const createQuery = `CREATE TABLE IF NOT EXISTS "${componentTableName}" (${columns.join(', ')});`;
    await this.dataSource.query(createQuery);

    console.log(
      `✅ Component table '${componentTableName}' created successfully`,
    );
  }

  async updateComponentTable(componentName: string, schema: any) {
    const tableName = `component_${componentName}`;
    const attributes = schema.attributes ?? {};

    for (const [attrName, attr] of Object.entries<any>(attributes)) {
      if (attr.type) {
        // Normal field → add or update column
        await this.addOrUpdateColumn(tableName, attrName, attr);
      } else if (attr.component) {
        // Nested component → create junction table with field column
        const targetComponent = attr.component;
        const relationTable = `component_${componentName}_components`;

        const createRelationQuery = `
        CREATE TABLE IF NOT EXISTS "${relationTable}" (
          id SERIAL PRIMARY KEY,
          entity_id INT NOT NULL,
          component_id INT NOT NULL,
          component_type TEXT NOT NULL, -- holds component name
          field TEXT NOT NULL, -- holds key like 'profilcard-1'
          FOREIGN KEY (entity_id) REFERENCES "${tableName}"(id)
        );
      `;
        await this.dataSource.query(createRelationQuery);

        console.log(
          `✅ Relation table '${relationTable}' created for nested component '${targetComponent}' (field: '${attrName}')`,
        );
      }
    }

    console.log(`✅ Component '${componentName}' updated successfully.`);
  }

  async addOrUpdateColumn(tableName: string, columnName: string, attr: any) {
    // Check if column exists
    const checkQuery = `
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name='${tableName}' AND column_name='${columnName}';
  `;
    const result = await this.dataSource.query(checkQuery);

    if (result.length === 0) {
      // Determine SQL type
      let type = 'TEXT';
      switch (attr.type) {
        case 'number':
          type = 'INT';
          break;
        case 'boolean':
          type = 'BOOLEAN';
          break;
        case 'array':
        case 'object':
          type = 'JSONB';
          break;
      }
      const required = attr.required ? 'NOT NULL' : '';
      const addColumnQuery = `ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${type} ${required};`;
      await this.dataSource.query(addColumnQuery);
      console.log(`✅ Column '${columnName}' added to '${tableName}'`);
    }
  }
}
