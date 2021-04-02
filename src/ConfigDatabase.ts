import { Guild, User } from "discord.js";
import { Db, MongoClient, ObjectId } from "mongodb";

const connectionUrl = "mongodb://localhost:27017/";
const dbName = "discord-game-statistics";
const userCollectionName = "users";
const sessionCollectionName = "sessions";

export let db: Db = undefined;
class InternalConfigDatabase {

    constructor() {
        this.getOrAddUser = this.getOrAddUser.bind(this);
        this.getOrAddUserById = this.getOrAddUserById.bind(this);
        this.getUser = this.getUser.bind(this);
        this.getUserById = this.getUserById.bind(this);
        this.removeUser = this.removeUser.bind(this);
        this.removeUserById = this.removeUserById.bind(this);
        this.getGuildIdsForUser = this.getGuildIdsForUser.bind(this);
        this.getGuildIdsForUserById = this.getGuildIdsForUserById.bind(this);
        this.addGuildIds = this.addGuildIds.bind(this);
        this.addGuildsById = this.addGuildsById.bind(this);
        this.removeGuildIds = this.removeGuildIds.bind(this);
        this.removeGuildsById = this.removeGuildsById.bind(this);
        this.getCurrentSessionForUser = this.getCurrentSessionForUser.bind(this);
        this.getCurrentSessionForUserById = this.getCurrentSessionForUserById.bind(this);
        this.getSessionsForGuildsById = this.getSessionsForGuildsById.bind(this);
        this.getSessionsForGuildsAndUsersById = this.getSessionsForGuildsAndUsersById.bind(this);
        this.getSessionsForUsersById = this.getSessionsForUsersById.bind(this);
        this.startSessionForUser = this.startSessionForUser.bind(this);
        this.startSessionForUserById = this.startSessionForUserById.bind(this);
        this.endCurrentSessionForUser = this.endCurrentSessionForUser.bind(this);
        this.endCurrentSessionForUserById = this.endCurrentSessionForUserById.bind(this);

        MongoClient.connect(connectionUrl).then(a => {
            db = a.db(dbName);
        });
    }

    public async getUser(user: User): Promise<UserConfig> {
        return await this.getUserById(user.id);
    }

    public async getUserById(userId: string): Promise<UserConfig> {
        const collection = db.collection(userCollectionName);
        try {
            const v = await collection.findOne({ id: userId });
            return v;
        } catch (e) {
            console.error('getUserById', e);
            return undefined;
        }
    }

    public async getOrAddUser(user: User): Promise<UserConfig> {
        return await this.getOrAddUserById(user.id);
    }

    public async getOrAddUserById(userId: string): Promise<UserConfig> {
        const collection = db.collection(userCollectionName);
        try {
            const v = await collection.findOneAndUpdate({ id: userId }, {
                $setOnInsert: {
                    id: userId,
                    guildIds: [],
                    sessionIds: [],
                }
            }, {
                upsert: true,
                returnOriginal: false,
            });
            return v.value;
        } catch (e) {
            console.error('addUserById', e);
            return undefined;
        }
    }

    public async removeUser(user: User) {
        return await this.removeUserById(user.id);
    }

    public async removeUserById(userId: string) {
        const collection = db.collection(userCollectionName);
        try {
            return await collection.findOneAndDelete({ id: userId });
        } catch (e) {
            console.error('removeUserById', e);
            return undefined;
        }
    }

    public async getGuildIdsForUser(user: User): Promise<string[]> {
        return await this.getGuildIdsForUserById(user.id);
    }

    public async getGuildIdsForUserById(userId: string): Promise<string[]> {
        const collection = db.collection(userCollectionName);
        try {
            const results = (await collection.findOne({ id: userId }))
            if (results && results.guildIds) {
                return results.guildIds;
            } else {
                this.getOrAddUserById(userId).then(userConfig => {
                    if (userConfig) {
                        console.log('Initialized user', userId);
                    }
                    return [];
                })
            }
            return [];
        } catch (e) {
            console.error('getGuildIdsByIdForUser', e);
            return [];
        }
    }

    public async addGuildIds(user: User, guildIds: string[]) {
        return await this.addGuildsById(user.id, guildIds);
    }

    public async addGuildsById(userId: string, guildIds: string[]) { 
        const collection = db.collection(userCollectionName);
        try {
            await this.getOrAddUserById(userId);

            const v = await collection.findOneAndUpdate({ id: userId }, {
                // Avoid dupes.
                $addToSet: {
                    guildIds: {
                        $each: guildIds
                    }
                }
            });
            return v;
        } catch (e) {
            console.error('addGuildsById', e);
            return undefined;
        }
    }

    public async removeGuildIds(user: User, guildIds: string[]) {
        return await this.removeGuildsById(user.id, guildIds);
    }

    public async removeGuildsById(userId: string, guildIds: string[]) {
        const collection = db.collection(userCollectionName);
        try {
            const v = await collection.findOneAndUpdate({ id: userId }, {
                $pull: {
                    guildIds: {
                        $in: guildIds
                    }
                }
            });
            return v;
        } catch (e) {
            console.error('removeGuildsById', e);
            return undefined;
        }
    }

    public async startSessionForUser(user: User, session: SessionConfig) {
        return await this.startSessionForUserById(user.id, session);
    }

    public async startSessionForUserById(userId: string, session: SessionConfig) {
        // Always kill the alive session, a user cannot be playing two sessions at once.
        await this.endCurrentSessionForUserById(userId);

        const userCollection = db.collection(userCollectionName);
        const sessionCollection = db.collection(sessionCollectionName);
        try {
            const sessionCreatedResult = await sessionCollection.insertOne({
                startTime: session.startTime.getTime(),
                endTime: session.endTime ? session.endTime.getTime() : -1,
                applicationId: session.applicationId,
                activityType: session.activityType,
                activityName: session.activityName,
                activityDetails: session.activityDetails || '',
                activityState: session.activityState || '',
                activityFlags: session.activityFlags,
                activityEmoji: session.activityEmoji || '',
                activityUrl: session.activityUrl || '',
                userId: userId,
            });

            if (sessionCreatedResult.insertedCount !== 1) {
                throw "Session creation failed, insert count was not 1.";
            }
            await this.getOrAddUserById(userId);
            const userSessionAddResult = await userCollection.findOneAndUpdate({ id: userId }, {
                // Avoid dupes.
                $addToSet: {
                    sessionIds: {
                        $each: [sessionCreatedResult.insertedId]
                    }
                }
            });
            return userSessionAddResult;
        } catch (e) {
            console.error('startSessionForUserById', e);
            return undefined;
        }

    }

    public async getSessionsForUsersById(userIds: string[], activityNameContains: string = undefined, 
                                        dateRangeStart: Date = undefined, dateRangeEnd: Date = undefined, currentSessionsOnly: boolean = false): Promise<SessionConfig[]> {
        const collection = db.collection(sessionCollectionName);
        try {
            let findQuery = { userId: { $in: userIds }};

            // If the start and end times are present, then go for additional querying.
            if (!!dateRangeStart && !!dateRangeEnd) {
                findQuery['startTime'] = {
                    $gte: dateRangeStart.getTime(),
                    $lte: dateRangeEnd.getTime()
                };
            } else if (!!dateRangeStart && !!!dateRangeEnd) {
                findQuery['startTime'] = {
                    $gte: dateRangeStart.getTime()
                };
            }
            if (!!activityNameContains) {
                findQuery['activityName'] = new RegExp(activityNameContains);
            }
            if (!!currentSessionsOnly) {
                findQuery['endTime'] = -1;
            }

            const results = await collection.find(findQuery)
            if (results) {
                return <SessionConfig[]>(await results.toArray());
            } else {
                return [];
            }
        } catch (e) {
            console.error('getCurrentSessionForUserById', e);
            return [];
        }
    }

    public async getSessionsForGuildsById(guilds: string[], activityNameContains: string = undefined, 
                                        dateRangeStart: Date = undefined, dateRangeEnd: Date = undefined, currentSessionsOnly: boolean = false): Promise<SessionConfigWithUserDetails[]> {
        const sessionCollection = db.collection(sessionCollectionName);

        try {
            let findQuery = {
                $match: {
                    $and: <any[]>[
                        {
                            guildIds: {
                                $in: guilds
                            }
                        },
                    ]
                }
            };

            // If the start and end times are present, then go for additional querying.
            if (!!dateRangeStart && !!dateRangeEnd) {
                findQuery.$match.$and.push(
                    {
                        startTime: {
                            $gte: dateRangeStart.getTime(),
                            $lte: dateRangeEnd.getTime()
                        }
                    });
            } else if (!!dateRangeStart && !!!dateRangeEnd) {
                findQuery.$match.$and.push(
                    {
                        startTime: {
                            $gte: dateRangeStart.getTime(),
                        }
                    });
            }
            if (!!activityNameContains) {
                findQuery.$match.$and.push(
                    {
                        activityName: new RegExp(activityNameContains)
                    });
            }
            if (!!currentSessionsOnly) {
                findQuery.$match.$and.push(
                    {
                        endTime: -1
                    });
            }

            const joinCursor = sessionCollection.aggregate([
                { 
                    $lookup: {
                        from: 'users',
                        localField: 'userId',
                        foreignField: 'id',
                        as: 'userDetails'
                    }
                },
                findQuery
            ]);

            const sessionResultsForGuilds = await joinCursor.toArray();

            if (sessionResultsForGuilds) {
                return <SessionConfigWithUserDetails[]>sessionResultsForGuilds;
            } else {
                return [];
            }
        } catch (e) {
            console.error('getSessionsForGuildsById', e);
            return [];
        }
    }

    public async getSessionsForGuildsAndUsersById(guilds: string[], users: string[], activityNameContains: string = undefined, 
                                        dateRangeStart: Date = undefined, dateRangeEnd: Date = undefined, currentSessionsOnly: boolean = false): Promise<SessionConfigWithUserDetails[]> {
        const sessionCollection = db.collection(sessionCollectionName);

        try {
            let findQuery = {
                $match: {
                    $and: <any[]>[
                        {
                            guildIds: {
                                $in: guilds
                            }
                        },
                        {
                            userId: {
                                $in: users,
                            }
                        },
                        
                    ]
                }
            };

            // If the start and end times are present, then go for additional querying.
            if (!!dateRangeStart && !!dateRangeEnd) {
                findQuery.$match.$and.push(
                    {
                        startTime: {
                            $gte: dateRangeStart.getTime(),
                            $lte: dateRangeEnd.getTime()
                        }
                    });
            } else if (!!dateRangeStart && !!!dateRangeEnd) {
                findQuery.$match.$and.push(
                    {
                        startTime: {
                            $gte: dateRangeStart.getTime(),
                        }
                    });
            }
            if (!!activityNameContains) {
                findQuery.$match.$and.push(
                    {
                        activityName: new RegExp(activityNameContains)
                    });
            }
            if (!!currentSessionsOnly) {
                findQuery.$match.$and.push(
                    {
                        endTime: -1
                    });
            }

            const joinCursor = sessionCollection.aggregate([
                { 
                    $lookup: {
                        from: 'users',
                        localField: 'userId',
                        foreignField: 'id',
                        as: 'userDetails'
                    }
                },
                findQuery
            ]);

            const sessionResultsForGuilds = await joinCursor.toArray();

            if (sessionResultsForGuilds) {
                return <SessionConfigWithUserDetails[]>sessionResultsForGuilds;
            } else {
                return [];
            }
        } catch (e) {
            console.error('getSessionsForGuildsAndUsersById', e);
            return [];
        }
    }

    public async getCurrentSessionForUser(user: User): Promise<SessionConfig> {
        return await this.getCurrentSessionForUserById(user.id);
    }

    public async getCurrentSessionForUserById(userId: string): Promise<SessionConfig> {
        const collection = db.collection(sessionCollectionName);
        try {
            const result = (await collection.findOne({ userId: userId, endTime: -1 }))
            if (result) {
                return <SessionConfig>result;
            } else {
                return undefined;
            }
        } catch (e) {
            console.error('getCurrentSessionForUserById', e);
            return undefined;
        }
    }

    // Always call this before starting a new session.
    public async endCurrentSessionForUser(user: User) {
        return await this.endCurrentSessionForUserById(user.id);
    }

    public async endCurrentSessionForUserById(userId: string) {
        const sessionCollection = db.collection(sessionCollectionName);
        try {
            const lastSessionResult = await sessionCollection.findOneAndUpdate({ endTime: -1, userId: userId }, {
                $set: {
                    endTime: new Date().getTime()
                }
            }, {
                upsert: false,
                returnOriginal: false,
            })
            return lastSessionResult;
        } catch (e) {
            console.error('endCurrentSessionForUserById', e);
            return undefined;
        }
    }
}

export interface UserConfig { 
    id: string;
    guildIds: string[];
    sessionIds: ObjectId[];

}
export interface SessionConfigWithUserDetails extends SessionConfig {
    userDetails: UserConfig;
}

export interface SessionConfig {
    startTime: Date;
    endTime?: Date;

    applicationId: string;
    activityType: string;
    activityName: string;
    activityDetails?: string;
    activityState?: string;
    activityFlags: number;
    activityEmoji?: string;
    activityUrl?: string;

    userId: string;
    _id: ObjectId;
}

export const ConfigDatabase = new InternalConfigDatabase();