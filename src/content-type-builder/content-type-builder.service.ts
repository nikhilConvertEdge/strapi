import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class ContentTypeBuilderService {
	constructor(private readonly contentTypeBuilder: DataSource) { }

	async createContentType(schema: any) {
		// 1️⃣ Determine table name
		const tableName = schema.collectionName;

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
				default:
					type = 'TEXT';
			}

			const required = attr.required ? 'NOT NULL' : '';
			columns.push(`"${attrName}" ${type} ${required}`);
		}

		// 3️⃣ Create table
		const createQuery = `CREATE TABLE IF NOT EXISTS "${tableName}" (${columns.join(', ')});`;
		await this.contentTypeBuilder.query(createQuery);
		console.log(`✅ Table '${tableName}' created successfully`);

		const metadata = {
			collectionName: schema.collectionName,
			mainTable: tableName,
			schema,
		};

		// 5️⃣ Create schema metadata table if not exists
		await this.contentTypeBuilder.query(`
    CREATE TABLE IF NOT EXISTS "schemas" (
      id SERIAL PRIMARY KEY,
      collection_name TEXT UNIQUE NOT NULL,
      collection_type TEXT NOT NULL,
      schema JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

		// 6️⃣ Store metadata in schemas table
		await this.contentTypeBuilder.query(
			`
    INSERT INTO "schemas" (collection_name, collection_type, schema)
    VALUES ($1, $2, $3)
    ON CONFLICT (collection_name)
    DO UPDATE SET 
      collection_type = EXCLUDED.collection_type,
      schema = EXCLUDED.schema,
      updated_at = NOW()
  `,
			[
				schema.collectionName,
				schema.type === 'content-type' ? 'content-type' : 'component',
				JSON.stringify(metadata),
			],
		);

		console.log(
			`✅ Metadata for '${schema.collectionName}' stored successfully`,
		);

		// 7️⃣ Return metadata instead of raw schema
		return { success: true, data: metadata };
	}

	async updateContentType(schema: any) {
		const tableName =
			schema.type === 'content-type'
				? schema.collectionName
				: `component_${schema.collectionName}`;

		// ------------------ 1️⃣ Update main table columns ------------------
		for (const [attrName, attr] of Object.entries<any>(schema.attributes)) {
			if (
				['component', 'relation'].includes(attr.type) ||
				attrName === 'dynamicZone'
			)
				continue;
			await this.addOrUpdateColumn(tableName, attrName, attr);
		}

		// ------------------ 2️⃣ Handle top-level components ------------------
		const components: Record<string, string> = {};
		for (const [attrName, attr] of Object.entries<any>(schema.attributes)) {
			const attrObj = attr as {
				type?: string;
				component?: string;
				attributes?: any;
			};

			if (attrObj.type !== 'component') continue;

			const safeComponentName = attrObj.component!.replace(/[-\s]/g, '_');
			const relationTable = `${tableName}_components`;

			components[attrName] = relationTable;

			// Only create component if not exists
			const [existingComp] = await this.contentTypeBuilder.query(
				`SELECT schema FROM schemas WHERE collection_name=$1`,
				[safeComponentName],
			);

			if (!existingComp) {
				await this.createComponent({
					collectionName: safeComponentName,
					attributes: attrObj.attributes ?? {},
				});
			}

			// Create junction table if not exists
			await this.contentTypeBuilder.query(`
    CREATE TABLE IF NOT EXISTS "${relationTable}" (
  id SERIAL PRIMARY KEY,
  entity_id INT REFERENCES "${tableName}"(id) ON DELETE CASCADE,
  component_id INT NOT NULL,          -- no FK here
  component_type TEXT NOT NULL,       -- stores which component table
  field TEXT NOT NULL
);

    `);
		}

		// ------------------ 3️⃣ Handle dynamicZone components ------------------
		const dynamicZone: Record<string, string> = {};

		if (Array.isArray(schema.attributes.dynamicZone)) {
			for (const dzItem of schema.attributes.dynamicZone) {
				const [attrName, attr] = Object.entries(dzItem)[0];
				const attrObj = attr as {
					type?: string;
					component?: string;
					attributes?: any;
				};

				if (attrObj.type !== 'component') continue;

				const safeComponentName = attrObj.component!.replace(/[-\s]/g, '_');
				const relationTable = `${tableName}_components`;

				dynamicZone[attrName] = relationTable;

				const [existingComp] = await this.contentTypeBuilder.query(
					`SELECT schema FROM schemas WHERE collection_name=$1`,
					[safeComponentName],
				);

				if (!existingComp) {
					await this.createComponent({
						collectionName: safeComponentName,
						attributes: attrObj.attributes ?? {},
					});
				}

				await this.contentTypeBuilder.query(`
     CREATE TABLE IF NOT EXISTS "${relationTable}" (
  id SERIAL PRIMARY KEY,
  entity_id INT REFERENCES "${tableName}"(id) ON DELETE CASCADE,
  component_id INT NOT NULL,          -- no FK here
  component_type TEXT NOT NULL,       -- stores which component table
  field TEXT NOT NULL
);

      `);
			}
		}

		// ------------------ 4️⃣ Handle relations ------------------
		const relations: Record<string, { junction: string; target: string }> = {};
		for (const [attrName, attr] of Object.entries<any>(schema.attributes)) {
			if (attr.type !== 'relation') continue;

			const relationTable = `${tableName}_${attrName}_link`;
			relations[attrName] = { junction: relationTable, target: attr.target };

			await this.contentTypeBuilder.query(`
      CREATE TABLE IF NOT EXISTS "${relationTable}" (
        id SERIAL PRIMARY KEY,
        entity_id INT REFERENCES "${tableName}"(id) ON DELETE CASCADE,
        ${attrName}_id INT REFERENCES "${attr.target}"(id) ON DELETE CASCADE
      );
    `);
		}

		// ------------------ 5️⃣ Build metadata JSON ------------------
		const metadata = {
			collectionName: schema.collectionName,
			mainTable: tableName,
			components, // top-level components
			dynamicZone, // dynamic zone components
			relations,
			schema,
		};

		// ------------------ 6️⃣ Upsert into schemas table ------------------
		await this.contentTypeBuilder.query(`
    CREATE TABLE IF NOT EXISTS "schemas" (
      id SERIAL PRIMARY KEY,
      collection_name TEXT UNIQUE NOT NULL,
      collection_type TEXT NOT NULL,
      schema JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

		await this.contentTypeBuilder.query(
			`
    INSERT INTO "schemas" (collection_name, collection_type, schema)
    VALUES ($1, $2, $3)
    ON CONFLICT (collection_name)
    DO UPDATE SET
      collection_type = EXCLUDED.collection_type,
      schema = EXCLUDED.schema,
      updated_at = NOW();
  `,
			[
				schema.collectionName,
				schema.type === 'content-type' ? 'content-type' : 'component',
				JSON.stringify(metadata),
			],
		);

		console.log(
			`✅ Schema and metadata updated for '${schema.collectionName}'`,
		);

		return { success: true, data: metadata };
	}

	async createComponent(schema: any) {
		const { collectionName } = schema;
		const safeComponentName = collectionName.replace(/[-\s]/g, '_');
		const componentTableName = `component_${safeComponentName}`;

		// 1️⃣ Create the physical component table
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
		await this.contentTypeBuilder.query(createQuery);
		console.log(
			`✅ Component table '${componentTableName}' created successfully`,
		);

		const components: Record<string, string> = {};
		const relations: Record<string, { junction: string; target: string }> = {};

		for (const [attrName, attr] of Object.entries<any>(
			schema.attributes ?? {},
		)) {
			if (attr.type === 'component') {
				const safeComponentName = attr.component.replace(/[-\s]/g, '_');
				const relationTable = `${componentTableName}_components`;
				components[attrName] = relationTable;
			}
			if (attr.type === 'relation') {
				const relationTable = `${componentTableName}_${attrName}_link`;
				relations[attrName] = { junction: relationTable, target: attr.target };
			}
		}

		const metadata = {
			collectionName,
			mainTable: componentTableName,
			components,
			relations,
			schema,
		};

		// 3️⃣ Upsert metadata in schemas table
		await this.contentTypeBuilder.query(`
    CREATE TABLE IF NOT EXISTS "schemas" (
      id SERIAL PRIMARY KEY,
      collection_name TEXT UNIQUE NOT NULL,
      collection_type TEXT NOT NULL,
      schema JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

		await this.contentTypeBuilder.query(
			`
    INSERT INTO "schemas" (collection_name, collection_type, schema)
    VALUES ($1, $2, $3)
    ON CONFLICT (collection_name)
    DO UPDATE SET
      collection_type = EXCLUDED.collection_type,
      schema = EXCLUDED.schema,
      updated_at = NOW()
  `,
			[collectionName, 'component', JSON.stringify(metadata)],
		);

		console.log(
			`✅ Component metadata for '${collectionName}' stored in schemas table`,
		);
		return { success: true, data: metadata };
	}

	async updateComponent(schema: any) {
		const { collectionName } = schema;
		const tableName = `component_${collectionName}`;
		const attributes = schema.attributes ?? {};

		// 1️⃣ Update or add columns in main component table
		for (const [attrName, attr] of Object.entries<any>(attributes)) {
			if (attr.type && attr.type !== 'component') {
				// Normal field → add or update column
				await this.addOrUpdateColumn(tableName, attrName, attr);
			} else if (attr.component) {
				// Nested component → create junction table
				const targetComponent = attr.component.replace(/[-\s]/g, '_');
				const relationTable = `component_${collectionName}_components`;

				const createRelationQuery = `
        CREATE TABLE IF NOT EXISTS "${relationTable}" (
          id SERIAL PRIMARY KEY,
          entity_id INT NOT NULL,
          component_id INT NOT NULL,
          component_type TEXT NOT NULL,
          field TEXT NOT NULL,
          FOREIGN KEY (entity_id) REFERENCES "${tableName}"(id)
        );
      `;
				await this.contentTypeBuilder.query(createRelationQuery);

				console.log(
					`✅ Relation table '${relationTable}' created for nested component '${targetComponent}' (field: '${attrName}')`,
				);
			}
		}

		// 2️⃣ Build components and relations metadata
		const components: Record<string, string> = {};
		const relations: Record<string, { junction: string; target: string }> = {};

		for (const [attrName, attr] of Object.entries<any>(attributes)) {
			if (attr.type === 'component') {
				// top-level component
				const safeComponentName = attr.component.replace(/[-\s]/g, '_');
				const relationTable = `${tableName}_components`;
				components[attrName] = relationTable;
			} else if (attr.component) {
				// nested component inside this component
				const relationTable = `component_${collectionName}_components`;
				components[attrName] = relationTable;
			}

			if (attr.type === 'relation') {
				const relationTable = `${tableName}_${attrName}_link`;
				relations[attrName] = { junction: relationTable, target: attr.target };
			}
		}

		// 4️⃣ Build final metadata object
		const metadata = {
			collectionName,
			mainTable: tableName,
			components,
			relations,
			schema,
		};

		// 5️⃣ Upsert metadata in schemas table
		await this.contentTypeBuilder.query(`
    CREATE TABLE IF NOT EXISTS "schemas" (
      id SERIAL PRIMARY KEY,
      collection_name TEXT UNIQUE NOT NULL,
      collection_type TEXT NOT NULL,
      schema JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

		await this.contentTypeBuilder.query(
			`
    INSERT INTO "schemas" (collection_name, collection_type, schema)
    VALUES ($1, $2, $3)
    ON CONFLICT (collection_name)
    DO UPDATE SET
      collection_type = EXCLUDED.collection_type,
      schema = EXCLUDED.schema,
      updated_at = NOW()
  `,
			[collectionName, 'component', JSON.stringify(metadata)],
		);

		console.log(
			`✅ Component metadata for '${collectionName}' stored/updated in schemas table`,
		);
		console.log(`✅ Component '${collectionName}' updated successfully.`);

		return { success: true, data: metadata };
	}

	async findAllSchemas() {
		// Ensure table exists (optional but recommended)
		await this.contentTypeBuilder.query(`
    CREATE TABLE IF NOT EXISTS "schemas" (
      id SERIAL PRIMARY KEY,
      collection_name TEXT UNIQUE NOT NULL,
      collection_type TEXT NOT NULL,
      schema JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

		const result = await this.contentTypeBuilder.query(`
    SELECT * FROM "schemas" ORDER BY created_at DESC;
  `);

		const contentTypes = [];
		const components = [];

		for (const row of result) {
			if (row.collection_type === 'content-type') {
				contentTypes.push(row);
			} else if (row.collection_type === 'component') {
				components.push(row);
			}
		}

		return {
			success: true,
			data: {
				contentTypes,
				components,
			},
		};
	}

	async findOneSchema(collectionName: string) {
		const result = await this.contentTypeBuilder.query(
			`SELECT * FROM schemas WHERE collection_name = $1`,
			[collectionName],
		);
		return {
			success: true,
			data: result,
		};
	}

	async addOrUpdateColumn(tableName: string, columnName: string, attr: any) {
		// Check if column exists
		const checkQuery = `
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name='${tableName}' AND column_name='${columnName}';
  `;
		const result = await this.contentTypeBuilder.query(checkQuery);

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
			await this.contentTypeBuilder.query(addColumnQuery);
			console.log(`✅ Column '${columnName}' added to '${tableName}'`);
		}
	}
}
