import { Client } from "discord.js";
import { ConfigDatabase, SessionConfig } from "./ConfigDatabase";

export class SessionMonitor {

    public onSessionStart: Function = (activity: any, startedSession: SessionConfig) => { 
        console.log('Activity Started', activity.name);
    };

    public onSessionEnd: Function = (activity: any, endedSession: SessionConfig) => { 
        console.log('Activity Ended', activity.name);
    };

    private monitorInterval: any;
    private userIdToAppName: any;
    
    public constructor(private client: Client) {
        this.userIdComparer = this.userIdComparer.bind(this);
        this.checkForChanges = this.checkForChanges.bind(this);
        this.groupBy = this.groupBy.bind(this);
        this.startSessionMonitor = this.startSessionMonitor.bind(this);
        this.stopSessionMonitor = this.stopSessionMonitor.bind(this);
    }

    public startSessionMonitor() {
        if (!this.monitorInterval) {
            this.checkForChanges();
            this.monitorInterval = setInterval(this.checkForChanges, 1000 * 10);
        }
    }

    public stopSessionMonitor() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
        }
    }

    private async checkForChanges() {
        // Call this every minute
        console.log('Checking for activities...');
        
        // Go through each user in cache, check if activity has changed since last time.
        // Detect if changed by storing a map between the session id and users, then checking and updating it as required.

        const userIds = this.client.users.cache.keyArray();
        const users = this.client.users.cache;

        const guilds = this.client.guilds.cache; 

        let userIdToGuild = [];
        guilds.forEach(async g => {
            let userIdsInGuild = g.members.cache.mapValues(v => v.user.id);
            userIdsInGuild.forEach(u => {
                userIdToGuild.push({
                    userId: u,
                    guildId: g.id,
                })
            })
        })

        // Now we have all the guilds a user is in by their user id.
        const groupByUserId = this.groupBy(userIdToGuild, ['userId']);
        const userIdKeys = Object.keys(groupByUserId);
        userIdKeys.forEach(async key => {
            const curGuilds = groupByUserId[key].map(v => v.guildId);
            // Just add, it won't dupe.
            await ConfigDatabase.addGuildsById(key, curGuilds);
        })

        // Get current user's and their current playing app.
        let curUserIdToAppId = [];
        users.forEach(async user => {
            if (user.partial) {
                await user.fetch();
            }
            if (user.bot) {
                return;
            }
            const data = user.presence.activities
                // Only get where it is playing and the app ID is recognised as a game.
                .filter(act => act.type === "PLAYING" && act.name !== null)
                .flatMap(act => { 
                    return {
                        ...act,
                        applicationId: act.applicationID,
                        userId: user.id,
                        activityName: act.name,
                        activityFlags: act.flags.bitfield,
                        activityType: act.type,
                        activityEmoji: act.emoji ? act.emoji.toString() : '',
                        activityDetails: act.details,
                        activityState: act.state,
                        activityUrl: act.url,
                    }
                })[0];
            if (data !== undefined) {
                curUserIdToAppId.push(data);
            }
        });

        // If first time through, we need to start sessions for everyone involved.
        if (this.userIdToAppName === undefined) {
            this.userIdToAppName = curUserIdToAppId;
            const curUserIdToAppIdDb = (await ConfigDatabase.getSessionsForUsersById(userIds, undefined, undefined, undefined, true));
            
            // The rest of them we need to add as new sessions.curUserIdToAppIdDb
            const dbUpdates = curUserIdToAppId.filter(this.userIdComparer(curUserIdToAppIdDb));
            const dbOriginal = curUserIdToAppIdDb.filter(this.userIdComparer(curUserIdToAppId));

            // Remove db original data that doesn't need updating.curUserIdToAppId
            const toAddSessionsOf = <any[]>dbOriginal.filter(this.userIdComparer(curUserIdToAppId));

            // Only add new sessions to the db, or those who have changed from the existing db.
            toAddSessionsOf.concat(dbUpdates).forEach(async act => {
                const startedSession = await ConfigDatabase.startSessionForUserById(act.userId, <SessionConfig>{
                    startTime: act.timestamps ? (act.timestamps.start ? act.timestamps.start : new Date()) : new Date(),
                    ...act
                });
                await this.onSessionStart(act, startedSession);
            });

            // To remove - sessions concluded.
            dbOriginal.forEach(async act => {
                const endedSession = await ConfigDatabase.endCurrentSessionForUserById(act.userId);
                if (endedSession !== null)
                    await this.onSessionEnd(act, endedSession);
            });

            return;
        } 
        let updates = curUserIdToAppId.filter(this.userIdComparer(this.userIdToAppName));
        
        // IS THIS THE DATA TO REMOVE?
        let sessionEndRequired = this.userIdToAppName.filter(this.userIdComparer(curUserIdToAppId));
        
        const allUpdatesAndOriginals = updates.concat(sessionEndRequired);
        
        // Only use the updates.
        // Updates is a list of all values that have changed app id from the previous.
        // If there is an update, we need to start a session.

        updates.forEach(async act => {
            const startedSession = await ConfigDatabase.startSessionForUserById(act.userId, <SessionConfig>{
                startTime: act.timestamps ? (act.timestamps.start ? act.timestamps.start : new Date()) : new Date(),
                ...act
            });
            await this.onSessionStart(act, startedSession);
        });
        sessionEndRequired.forEach(async act => {
            const endedSession = await ConfigDatabase.endCurrentSessionForUserById(act.userId);
            if (endedSession !== null)
                await this.onSessionEnd(act, endedSession);
        });
        this.userIdToAppName = curUserIdToAppId;
    }

    
    private userIdComparer(otherArray){
        return function(current){
            return otherArray.filter(function(other){ 
            // Change to activity name instead. Allows to capture more games.
            return other.userId == current.userId && other.activityName == current.activityName
            }).length == 0;
        }
    }

    private groupBy<T>(arr: T[], keys: (keyof T)[]): { [key: string]: T[] } {
        return arr.reduce((storage, item) => {
            const objKey = keys.map(key => `${ item[key] }`).join(':');
            if (storage[objKey]) {
              storage[objKey].push(item);
            } else {
              storage[objKey] = [item];
            }
            return storage;
          }, {} as { [key: string]: T[] });
    };
      
}
