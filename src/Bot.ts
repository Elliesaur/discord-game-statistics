import {
    Client,
    Message,
    TextChannel,
    Constants,
} from 'discord.js';
import logs from 'discord-logs';
import { ConfigDatabase, SessionConfig, SessionConfigWithUserDetails, UserConfig } from './ConfigDatabase';

const client = new Client({ partials: Object.values(Constants.PartialTypes)  });
const commands = [''];
logs(client);

class Bot {

    private intervalCheckActivities: any = undefined;
    private userIdToAppId = undefined;
    private userIdToGuildId = undefined;

    constructor() {
        this.chunkString = this.chunkString.bind(this);
        this.safe = this.safe.bind(this);
        this.start = this.start.bind(this);
        this.handleCommands = this.handleCommands.bind(this);
        this.userIdComparer = this.userIdComparer.bind(this);
        this.checkForActivities = this.checkForActivities.bind(this);
        this.groupBy = this.groupBy.bind(this);
    }

    private chunkString(str: string, size: number) {
        const numChunks = Math.ceil(str.length / size)
        const chunks = new Array(numChunks)

        for (let i = 0, o = 0; i < numChunks; ++i, o += size) {
            chunks[i] = str.substr(o, size)
        }

        return chunks;
    }

    private safe(str: string) {
        return str.replace(/`/g, '');
    }

    public start() {

        (<any>client).on('messageContentEdited', this.handleCommands);
        client.on('message', this.handleCommands);
        client.on("guildCreate", guild => {
            console.log(`New guild joined: ${guild.name} (id: ${guild.id}). This guild has ${guild.memberCount} members!`);
            client.user.setActivity(`Serving ${client.guilds.cache.size} servers`);
        });

        client.on('ready', () => {

            console.log(`Bot has started, with ${client.users.cache.size} users in cache, in ${client.channels.cache.size} cached channels of ${client.guilds.cache.size} cached guilds.`); 
            client.user.setActivity(`Serving ${client.guilds.cache.size} servers`);
            console.log(`Logged in as ${client.user.tag}!`);
        
            

            if (this.intervalCheckActivities === undefined) {
                this.checkForActivities();

                // Set interval for checking activities.
                this.intervalCheckActivities = setInterval(this.checkForActivities, 1000*60);
            }
        });
        

        client.login(process.env.DISCORD_BOT_TOKEN);
    }

    // Call this every minute
    private async checkForActivities() {
        console.log('Checking for activities...');
        
        // Go through each user in cache, check if activity has changed since last time.
        // Detect if changed by storing a map between the session id and users, then checking and updating it as required.

        const userIds = client.users.cache.keyArray();
        const users = client.users.cache;

        const guildIds = client.guilds.cache.keyArray();
        const guilds = client.guilds.cache; 

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
            const data = user.presence.activities
                // Only get where it is playing and the app ID is recognised as a game.
                .filter(act => act.type === "PLAYING" && act.applicationID !== null)
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
        if (this.userIdToAppId === undefined) {
            this.userIdToAppId = curUserIdToAppId;
            const curUserIdToAppIdDb = (await ConfigDatabase.getSessionsForUsersById(userIds, undefined, undefined, undefined, true));
            
            // The rest of them we need to add as new sessions.curUserIdToAppIdDb
            const dbUpdates = curUserIdToAppId.filter(this.userIdComparer(curUserIdToAppIdDb));
            const dbOriginal = curUserIdToAppIdDb.filter(this.userIdComparer(curUserIdToAppId));

            // Remove db original data that doesn't need updating.curUserIdToAppId
            const toAddSessionsOf = <any[]>dbOriginal.filter(this.userIdComparer(curUserIdToAppId));

            // Only add new sessions to the db, or those who have changed from the existing db.
            toAddSessionsOf.concat(dbUpdates).forEach(async act => {
                await ConfigDatabase.startSessionForUserById(act.userId, <SessionConfig>{
                    startTime: act.timestamps.start ? act.timestamps.start : new Date(),
                    ...act
                });
            });

            return;
        } 
        let updates = curUserIdToAppId.filter(this.userIdComparer(this.userIdToAppId));
        let updatedOriginalData = this.userIdToAppId.filter(this.userIdComparer(curUserIdToAppId));
        
        const allUpdatesAndOriginals = updates.concat(updatedOriginalData);
        
        // Only use the updates.
        // Updates is a list of all values that have changed app id from the previous.
        // If there is an update, we need to start a session.

        updates.forEach(async act => {
            await ConfigDatabase.startSessionForUserById(act.userId, <SessionConfig>{
                startTime: act.timestamps.start ? act.timestamps.start : new Date(),
                ...act
            });
        });

    }

    private userIdComparer(otherArray){
        return function(current){
            return otherArray.filter(function(other){
            return other.userId == current.userId && other.applicationId == current.applicationId
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
      
    private async handleCommands(message: Message) {
        // Fetch the full message if partial.
        if (message.partial)
            await message.fetch();
        // Skip itself, do not allow it to process its own messages.
        if (message.author.id === client.user.id)
            return;
        // Skip other bots now.
        if (message.author.bot)
            return;
        // Check for commands always before.
        if (message.content.indexOf('!') === 0) {
            const args = message.content.slice(1).trim().split(/ +/g);
            const command = args.shift().toLowerCase();
            // if (command === 'settoxchannel') {
            //     if (!message.member.hasPermission("ADMINISTRATOR")) {
            //         return;
            //     }
            //     let channelMentions = message.mentions.channels;
            //     if (channelMentions.size > 0) {
            //         let firstChannel = channelMentions.keys().next().value;
            //         ConfigDatabase.updateGuildLogChannel(message.guild, firstChannel).then(x => {
            //             if (x.ok) {
            //                 message.reply(`Set the log channel to ${firstChannel}`);
            //             }
            //             else {
            //                 message.reply(`Failed to set the log channel to ${firstChannel}`);
            //             }
            //         });
            //     }
            // }
            // else if (command === 'removetox') {
            //     if (!message.member.hasPermission("ADMINISTRATOR")) {
            //         return;
            //     }
            //     ConfigDatabase.removeUser(message.guild).then(async res => {
            //         await message.reply(`Successfully removed all data related to this server from my database. I'll now leave the server. Thanks for having me!`);
            //         message.guild.leave().then(left => {
            //             console.log(`Left guild gracefully - ${message.guild.name}`);
            //         }).catch(async err => {
            //             console.error(`Failed to leave guild gracefully - ${message.guild.name}`);
            //             await message.reply(`Unfortunately I couldn't leave by myself. You may kick me.`);
            //         });
            //     });
            // }
            // else if (!commands.includes(command)) {
            //     // Process profanity check
            //     return;
            // }
        }
    }
}

export = new Bot();